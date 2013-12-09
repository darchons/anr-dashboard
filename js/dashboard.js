$(function() {

"use strict";

var anrTelemetry = null;
var serverUri = "http://people.mozilla.org/~nchen/anrs/anr-{from}-{to}";
var defaultDimension = "submission_date";
var topANRs = 10;
var maxStackFrames = 10;

var anrColors = (function() {
    var colors = [];
    for (var i = 0; i <= topANRs; i++) {
        colors.push(Color({
            h: 222 - 222 * i / topANRs,
            s: 55,
            l: 55,
        }).hexString());
    }
    return colors;
})();

$(".plot").each(function(i, plot) {
    $(plot).height($(plot).parent().height() - $(plot).position().top);
});

$("#navbar-filter").popover({
    html: true,
    content: function() {
        return $("#popover-filter").html();
    }
});

function replotANR(elem, dim) {
    var values = dim.getValues();
    values.sort();

    var anrs = dim.getANRs();
    anrs.sort(function(anr1, anr2) {
        return anr1.getCount() - anr2.getCount();
    });
    var otherANRs = anrs.slice(0, -topANRs);

    var data = [{
        label: "other",
        data: values.map(function(value, index) {
            return [index, otherANRs.reduce(function(prev, anr) {
                return prev + anr.getCountByValue(value);
            }, 0)];
        }),
        anr: null,
    }];
    anrs.slice(-topANRs).forEach(function(anr) {
        data.push({
            data: values.map(function(value, index) {
                return [index, anr.getCountByValue(value)];
            }),
            anr: anr,
        });
    });

    function _tooltip(label, xval, yval, item) {
        var tip = item.series.data[item.dataIndex][1] + " reports";
        var anr = item.series.anr;
        if (anr) {
            var out = null;
            anr.getMainThread(function(threads) {
                var stack = "<hr>";
                var count = 0;
                threads[0].getStack().every(function(frame, index) {
                    if (!frame.isJava()) {
                        return true;
                    }
                    var line = frame.getLine();
                    stack += (count ? "<br>" : "") +
                        frame.getFunction() +
                        (line ? " (line " + line + ")" : "");
                    return (++count) < maxStackFrames;
                });
                if (out) {
                    var tipelem = $("#flotTip");
                    var origheight = tipelem.height();
                    $("#anr-plot-stack").html(stack);
                    tipelem.offset({
                        top: tipelem.offset().top -
                             (tipelem.height() - origheight) / 2,
                    });
                } else {
                    out = stack;
                }
            });
            out = "<div id='anr-plot-stack'>" + (out || "") + "</div>";
            tip += out;
        }
        return tip;
    }
    function _tooltipHover(item, tooltip) {
        var baroffset = plotobj.pointOffset({
            x: item.datapoint[0] + 0.5,
            y: (item.datapoint[1] + item.datapoint[2]) / 2,
        });
        var plotoffset = elem.offset();
        tooltip.removeClass("bottom").addClass("right")
        .html(
            "<div class='tooltip-inner'>" + tooltip.html() + "</div>" +
            "<div class='tooltip-arrow'></div>")
        .offset({
            left: plotoffset.left + baroffset.left,
            top: plotoffset.top + baroffset.top - tooltip.height() / 2,
        });
    }

    var plotobj = $.plot(elem, data, {
        series: {
            stack: true,
            bars: {
                show: true,
                align: "center",
                barWidth: 0.9,
            },
        },
        grid: {
            show: true,
            clickable: true,
            hoverable: true,
        },
        xaxis: {
            ticks: values.map(function(value, index) {
                return [index, value];
            }),
        },
        colors: anrColors,
        tooltip: true,
        tooltipOpts: {
            content: _tooltip,
            onHover: _tooltipHover,
        },
    });
}

function replotInfo(elem, dim, value) {
    var agg = value ? dim.getAggregateByValue(value)
                    : dim.getAggregate();

    var seriescount = 0;
    var infos = Object.keys(agg);
    infos.sort(function(a, b) {
        return a === b ? 0 :
               a.toUpperCase() < b.toUpperCase() ? 1 : -1;
    });
    var data = infos.map(function(info, index) {
        var histogram = agg[info];
        var valuesarray = Object.keys(histogram);
        seriescount = Math.max(seriescount, valuesarray.length);
        valuesarray = valuesarray.map(function(value) {
            return [value, histogram[value]];
        });
        valuesarray.sort(function(val1, val2) {
            return val2[1] - val1[1];
        });
        var total = valuesarray.reduce(function(prev, value) {
            return prev + value[1];
        }, 0) / 100;
        return valuesarray.map(function(value) {
            return {info: value[0], data: [value[1] / total, index]};
        });
    });

    var plotdata = [];
    data.forEach(function(info, infoindex) {
        var prevmapto = -1;
        info.forEach(function(series, index) {
            var mapto = Math.max(prevmapto + 1, Math.round(100 - series.data[0]));
            for (var i = prevmapto + 1; i < mapto; i++) {
                plotdata[i] = (plotdata[i] || {
                    data: [],
                    anr_info: [],
                });
                plotdata[i].data.push([0, series.data[1]]);
                plotdata[i].anr_info.push(null);
            }
            plotdata[mapto] = (plotdata[mapto] || {
                data: [],
                anr_info: [],
            });
            plotdata[mapto].data.push(series.data);
            plotdata[mapto].anr_info.push(series.info);
            prevmapto = mapto;
        });
    });

    var colors = [];
    for (var i = 0; i <= 100; i++) {
        var scale = Math.pow(i / 100, 4);
        colors.push(Color({
            h: 177 * scale + 22,
            s: 44,
            l: 55,
        }).hexString());
    }
    for (var i = 0; i < seriescount; i++) {
        colors.push(Color({h: 200, s: 44, l: 55}).hexString());
    }

    function _tooltip(label, xval, yval, item) {
        return item.series.anr_info[item.dataIndex] + ": " +
               Math.round(item.series.data[item.dataIndex][0]) + "%";
    }
    function _tooltipHover(item, tooltip) {
        var baroffset = plotobj.pointOffset({
            x: (item.datapoint[0] + item.datapoint[2]) / 2,
            y: item.datapoint[1] - 0.5,
        });
        var plotoffset = elem.offset();
        tooltip.removeClass("right").addClass("bottom")
        .html(
            "<div class='tooltip-inner'>" + tooltip.html() + "</div>" +
            "<div class='tooltip-arrow'></div>")
        .offset({
            left: plotoffset.left + baroffset.left - tooltip.width() / 2,
            top: plotoffset.top + baroffset.top,
        });
    }

    var plotobj = $.plot(elem, plotdata, {
        series: {
            stack: true,
            bars: {
                show: true,
                align: "center",
                barWidth: 0.6,
                horizontal: true,
            },
        },
        grid: {
            show: true,
            color: "transparent",
            hoverable: true,
        },
        yaxis: {
            show: true,
            ticks: infos.map(function(info, index) {
                return [index, info];
            }),
        },
        xaxis: {
            show: false,
        },
        colors: colors,
        tooltip: true,
        tooltipOpts: {
            content: _tooltip,
            onHover: _tooltipHover,
        },
    });
}

$("#navbar-groupby").change(function() {
    var val = $("#navbar-groupby").val();
    if (!val) {
        $.plot($("#anr-plot"), [[0, 0]], {grid: {show: true}});
        $.plot($("#info-plot"), [[0, 0]], {grid: {show: false}});
        $("#info-dim-value").empty().off("change");
        return $("#navbar-count").text(0);
    }
    anrTelemetry.getDimension(val, function(dim) {
        $("#navbar-count").text(dim.getANRCount());
        replotANR($("#anr-plot"), dim);

        var infodim = $("#info-dim-value").empty().off("change");
        var values = dim.getValues();
        values.sort();
        values.unshift("(all groups)");
        values.forEach(function(value) {
            infodim.append($("<option/>").text(value))
        });
        infodim[0].selectedIndex = 0;
        infodim.change(function() {
            replotInfo($("#info-plot"), dim,
                infodim[0].selectedIndex == 0 ? null : infodim.val());
        }).trigger("change");
    });
});

$("#navbar-from").change(function() {
    var toDate = Date.today().last().saturday();
    if (Date.today().isBefore(
            toDate.clone().next().day()
                .add(-toDate.getTimezoneOffset()).minutes()
                .add(8 /* PST */).hours())) {
        toDate.last().saturday();
    }
    toDate = toDate.add(-$("#navbar-from")[0].selectedIndex).weeks();

    var fromDate = toDate.clone().last().sunday();
    var uri = serverUri.replace("{from}", fromDate.toString("yyyyMMdd"))
                       .replace("{to}", toDate.toString("yyyyMMdd"));

    var groupby = $("#navbar-groupby").empty().trigger("change");

    anrTelemetry = new ANRTelemetry();
    anrTelemetry.init(uri, function() {
        var dims = anrTelemetry.getDimensions();
        dims.sort();
        dims.forEach(function(dim) {
            groupby.append($("<option/>").text(dim));
        });
        groupby.val(defaultDimension).trigger("change");
    });
}).trigger("change");

});
