(function(exports) {

"use strict";

function ANRTelemetry() {
}

ANRTelemetry.prototype = {

    _get: function(file, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", this._root + file, true);
        xhr.onload = function() {
            cb(JSON.parse(xhr.responseText));
        };
        xhr.onerror = function(e) {
            throw new Error("ANRTelemetry: failed to retrieve file.");
        };
        xhr.send(null);
    },

    init: function(rootUri, cb) {
        if (rootUri.lastIndexOf("/") != rootUri.length - 1) {
            rootUri = rootUri + "/";
        }
        this._root = rootUri
        this._dimensions = {};
        this._threads = {};

        var self = this;
        this._get("index.json", function(index) {
            self.index = index;
            cb(self);
        });
    },

    getDimensions: function() {
        return Object.keys(this.index.dimensions);
    },

    _getData: function(dim, obj, data, cache, cb) {
        if (!this.index.dimensions[dim] ||
            !data[dim]) {
            throw new Error("ANRTelemetry: invalid dimension.");
        }
        var self = this;
        function _getCached() {
            return cb(new obj(self, dim, cache[dim]));
        }
        if (cache[dim]) {
            return _getCached();
        }
        this._get(data[dim], function(content) {
            cache[dim] = content;
            _getCached();
        });
    },

    getDimension: function(dim, cb) {
        return this._getData(dim, Dimension,
            this.index.dimensions, this._dimensions, cb);
    },

    _getThreads: function(type, key, data, cache, cb) {
        function _getCached() {
            return cb(cache[type].map(function(thread) {
                return new Thread(thread);
            }));
        }
        if (cache[type]) {
            return _getCached();
        }
        this._get(data, function(content) {
            cache[type] = [].concat(content);
            _getCached();
        });
    },

    _getMainThread: function(key, cb) {
        this._getThreads("mainThread", key,
            this.index.main_thread, this._threads, cb);
    },

    _getBackgroundThreads: function(key, cb) {
        this._getThreads("backgroundThreads", key,
            this.index.main_thread, this._threads, cb);
    },
};

function Dimension(anr, dim, content) {
    this._anr = anr;
    this._dim = dim;
    this._content = content;
    this._value_agg = {};
}

Dimension.prototype = {

    getName: function() {
        return this._dim;
    },

    getValues: function() {
        var values = {};
        for (var key in this._content) {
            var anr = this._content[key];
            for (var value in anr) {
                values[value] = null;
            }
        }
        return Object.keys(values);
    },

    getANRCount: function() {
        var agg = this.getInfoDistribution();
        var max = 0;
        for (var info in agg) {
            var histogram = agg[info];
            var count = 0;
            for (var value in histogram) {
                count += histogram[value];
            }
            max = Math.max(max, count);
        }
        return max;
    },

    getUniqueANRCount: function() {
        return Object.keys(this._content).length;
    },

    getANRs: function() {
        var self = this;
        return Object.keys(this._content).map(function(key) {
            return new ANR(self._anr, key, self._content[key]);
        });
    },

    _aggregate: function(agg, histograms) {
        for (var info in histograms) {
            var agg_histogram = agg[info] || {};
            var histogram = histograms[info];
            for (var value in histogram) {
                agg_histogram[value] =
                    (agg_histogram[value] || 0) + histogram[value];
            }
            agg[info] = agg_histogram;
        }
    },

    getInfoDistribution: function(value) {
        value = value || null;
        if (!this._value_agg[value]) {
            var self = this;
            this._value_agg[value] = Object.keys(this._content)
                                           .reduce(function(prev, key) {
                if (value) {
                    self._aggregate(prev, self._content[key][value]);
                } else {
                    var anr = self._content[key];
                    for (var val in anr) {
                        self._aggregate(prev, anr[val]);
                    }
                }
                return prev;
            }, {});
        }
        return this._value_agg[value];
    },

    filter: function() {
    },
};

function ANR(anr, key, value_histograms) {
    this._anr = anr;
    this._key = key;
    this._value_histograms = value_histograms;
    this._value_count = {};
}

ANR.prototype = {

    getMainThread: function(cb) {
        return this._anr._getMainThread(this._key, cb);
    },

    getBackgroundThreads: function(cb) {
        return this._anr._getBackgroundThreads(this._key, cb);
    },

    _countHistograms: function(histograms) {
        var max = 0;
        for (var info in histograms) {
            var count = 0;
            var histogram = histograms[info];
            for (var value in histogram) {
                count += histogram[value];
            }
            max = Math.max(max, count);
        }
        return max;
    },

    getCountByValue: function(value) {
        if (!this._value_count[value]) {
            this._value_count[value] =
                this._countHistograms(this._value_histograms[value]);
        }
        return this._value_count[value];
    },

    getCount: function() {
        if (!this._count) {
            var count = 0;
            for (var value in this._value_histograms) {
                count += this._countHistograms(this._value_histograms[value]);
            }
            this._count = count;
        }
        return this._count;
    },
};

function Thread(thread) {
    this._thread = thread;
}

Thread.prototype = {

    getName: function() {
        return this._thread.name;
    },

    getStack: function() {
        return this._thread.stack.map(function(frame) {
            return new StackFrame(frame);
        });
    },
};

function StackFrame(frame) {
    this._components = frame.split(':');
}

StackFrame.prototype = {

    isNative: function() {
        return this._components[0] === "c";
    },

    isJava: function() {
        return this._components[0] === "j";
    },

    getFunction: function() {
        if (this.isJava()) {
            return this._components[1];
        } else if (this.isNative()) {
            return this._components[2];
        }
    },

    getLib: function() {
        if (this.isNative()) {
            return this._components[1];
        }
    },

    getLine: function() {
        if (this.isJava()) {
            return this._components[2];
        }
    },
};

exports.ANRTelemetry = ANRTelemetry;

})(this);
