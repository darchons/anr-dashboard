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
        this._sessions = {};
        this._threads = {};

        var self = this;
        this._get("index.json", function(index) {
            self.index = index;
            cb(self);
        });
    },

    dimensions: function() {
        return Object.keys(this.index.dimensions);
    },

    _getCollection: function(dim, obj, data, cache, cb) {
        if (!this.index.dimensions[dim] ||
            !data[dim]) {
            throw new Error("ANRTelemetry: invalid dimension.");
        }
        var self = this;
        function _getCached() {
            return cb(new Collection(self, dim, cache[dim], obj));
        }
        if (cache[dim]) {
            return _getCached();
        }
        this._get(data[dim], function(content) {
            cache[dim] = content;
            _getCached();
        });
    },

    reports: function(dim, cb) {
        return this._getCollection(dim, Report,
            this.index.dimensions, this._dimensions, cb);
    },

    sessions: function(dim, cb) {
        return this._getCollection(dim, Session,
            this.index.sessions, this._sessions, cb);
    },

    _getThreads: function(type, key, data, cache, cb) {
        function _getCached() {
            return cb(cache[type][key].map(function(thread) {
                return new Thread(thread);
            }));
        }
        if (cache[type]) {
            return _getCached();
        }
        this._get(data, function(content) {
            cache[type] = content;
            _getCached();
        });
    },

    _mainThread: function(key, cb) {
        this._getThreads("mainThread", key,
            this.index.main_thread, this._threads, cb);
    },

    _backgroundThreads: function(key, cb) {
        this._getThreads("backgroundThreads", key,
            this.index.background_threads, this._threads, cb);
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
};

function Collection(telemetry, dim, content, obj) {
    this._telemetry = telemetry;
    this._dim = dim;
    this._content = content;
    this._obj = obj;
    this._value_agg = {};
}

Collection.prototype = {

    dimension: function() {
        return this._dim;
    },

    dimensionValues: function() {
        var values = {};
        for (var name in this._content) {
            var item = this._content[name];
            for (var value in item) {
                values[value] = null;
            }
        }
        return Object.keys(values);
    },

    cumulativeCount: function() {
        var agg = this.infoDistribution();
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

    length: function() {
        return Object.keys(this._content).length;
    },

    all: function() {
        var self = this;
        return Object.keys(this._content).map(function(name) {
            return new self._obj(self._telemetry, name, self._content[name]);
        });
    },

    byName: function(name) {
        return new this._obj(this._telemetry, name, this._content[name]);
    },

    infoDistribution: function(dimensionValue) {
        var value = dimensionValue || null;
        if (!this._value_agg[value]) {
            var self = this;
            this._value_agg[value] = Object.keys(this._content)
                                           .reduce(function(prev, name) {
                if (value) {
                    self._telemetry._aggregate(prev, self._content[name][value]);
                } else {
                    var item = self._content[name];
                    for (var val in item) {
                        self._telemetry._aggregate(prev, item[val]);
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

function CollectionItem(telemetry, name, value_histograms) {
    this._telemetry = telemetry;
    this._name = name;
    this._value_histograms = value_histograms;
    this._value_count = {};
    this._value_agg = {};
}

CollectionItem.prototype = {

    name: function() {
        return this._name;
    },

    count: function(dimensionValue) {
        var value = dimensionValue || null;
        if (!this._value_count[value]) {
            if (value) {
                this._value_count[value] =
                    this._telemetry._countHistograms(
                        this._value_histograms[value]);
            } else {
                var count = 0;
                for (var val in this._value_histograms) {
                    count += this._telemetry._countHistograms(
                        this._value_histograms[val]);
                }
                this._value_count[value] = count;
            }
        }
        return this._value_count[value];
    },

    infoDistribution: function(dimensionValue) {
        var value = dimensionValue || null;
        if (!this._value_agg[value]) {
            var agg = {};
            if (value) {
                this._telemetry._aggregate(agg, this._value_histograms[value]);
            } else {
                for (var val in this._value_histograms) {
                    this._telemetry._aggregate(agg, this._value_histograms[val]);
                }
            }
            this._value_agg[value] = agg;
        }
        return this._value_agg[value];
    },
};

function Session() {
    CollectionItem.apply(this, arguments);
}

Session.prototype = new CollectionItem();
Session.prototype.constructor = Session;

function Report() {
    CollectionItem.apply(this, arguments);
}

Report.prototype = new CollectionItem();
Report.prototype.constructor = Report;

Report.prototype.mainThread = function(cb) {
    return this._telemetry._mainThread(this._name, cb);
};

Report.prototype.backgroundThreads = function(cb) {
    return this._telemetry._backgroundThreads(this._name, cb);
};

function Thread(thread) {
    this._thread = thread;
}

Thread.prototype = {

    name: function() {
        return this._thread.name;
    },

    stack: function() {
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

    isPseudo: function() {
        return this._components[0] === "p";
    },

    functionName: function() {
        if (this.isJava()) {
            return this._components[1];
        } else if (this.isNative()) {
            return this._components[2];
        } else if (this.isPseudo()) {
            return this._components[1];
        }
    },

    libName: function() {
        if (this.isNative()) {
            return this._components[1];
        }
    },

    lineNumber: function() {
        if (this.isJava()) {
            return this._components[2];
        }
    },
};

exports.ANRTelemetry = ANRTelemetry;

})(this);
