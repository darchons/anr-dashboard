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

        var self = this;
        this._get("index.json", function(index) {
            self.index = index;
            cb(self);
        });
    },

    getDimensions: function() {
        return Object.keys(this.index.dimensions);
    },

    getDimension: function(dim, cb) {
        if (!this.index.dimensions[dim]) {
            throw new Error("ANRTelemetry: invalid dimension.");
        }
        var self = this;
        function _getCachedDimension() {
            return cb(new Dimension(self, dim, self._dimensions[dim]));
        }
        if (this._dimensions[dim]) {
            return _getCachedDimension();
        }
        this._get(this.index.dimensions[dim], function(content) {
            self._dimensions[dim] = content;
            _getCachedDimension();
        });
    },

    _getThreads: function(threads, cb) {
        return cb(threads.map(function(thread) {
            return new Thread(thread);
        }));
    },

    _getMainThread: function(key, cb) {
        if (this._mainThread) {
            return this._getThreads([this._mainThread[key]], cb);
        }
        var self = this;
        this._get(this.index.main_thread, function(content) {
            self._mainThread = content;
            self._getThreads([self._mainThread[key]], cb);
        });
    },

    _getBackgroundThreads: function(key, cb) {
        if (this._backgroundThreads) {
            return this._getThreads(this._backgroundThreads[key], cb);
        }
        var self = this;
        this._get(this.index.background_threads, function(content) {
            self._backgroundThreads = content;
            self._getThreads(self._backgroundThreads[key], cb);
        });
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
        var agg = this.getAggregate();
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

    getAggregateByValue: function(value) {
        if (!this._value_agg[value]) {
            var self = this;
            this._value_agg[value] = Object.keys(this._content)
                                           .reduce(function(prev, key) {
                self._aggregate(prev, self._content[key][value]);
                return prev;
            }, {});
        }
        return this._value_agg[value];
    },

    getAggregate: function() {
        if (!this._agg) {
            var self = this;
            this._agg = Object.keys(this._content).reduce(function(prev, key) {
                var anr = self._content[key];
                for (var value in anr) {
                    self._aggregate(prev, anr[value]);
                }
                return prev;
            }, {});
        }
        return this._agg;
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
        if (!this._stack) {
            this._stack = this._thread.stack.map(function(frame) {
                return new StackFrame(frame);
            });
        }
        return this._stack;
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
