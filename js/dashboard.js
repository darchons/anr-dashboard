$(function() {

"use strict";

var telemetry = null;
var serverUri = "http://people.mozilla.org/~nchen/anrs/anr-{from}-{to}";
var defaultDimension = "submission_date";

var maxStackFrames = 10;
var topReports = 10;
var reportColors = (function() {
    var colors = [];
    for (var i = 0; i <= topReports; i++) {
        colors.push(Color({
            h: 222 - 222 * i / topReports,
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

var re_grouping = /\D+|\d+/g;
function smartSort(str1, str2) {
    var match1 = (str1 + '').match(re_grouping);
    var match2 = (str2 + '').match(re_grouping);
    for (var i = 0; i < match1.length && i < match2.length; i++) {
        var diff = match1[i] - match2[i];
        if (!isNaN(diff)) {
            if (diff !== 0) {
                return diff;
            }
            continue;
        }
        var m1 = match1[i].toUpperCase();
        var m2 = match2[i].toUpperCase();
        if (m1 < m2) {
            return -1;
        } else if (m1 > m2) {
            return 1;
        }
    }
    return match1.length - match2.length;
}
function revSmartSort(str1, str2) {
    return -smartSort(str1, str2);
}

function replaceBrackets(str) {
    return str && str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fillReportModal(modal, report, dimValue, sessions) {

    $("#report-info-plot").prev("i.fa-spinner").fadeIn();
    modal.find(".spinner-holder i").fadeIn();

    var stacks = $("#report-stacks");
    var template = $("#report-stacks-thread");
    stacks.children().not(template).not(".spinner-holder").remove();

    function addThreads(threads, append) {
        var out = $();
        threads.forEach(function(thread) {
            var clone = template.clone()
                .removeAttr("id").removeClass("hide");
            var body = clone.find(".panel-body");
            var stack = thread.stack();
            var muteNative = stack.some(function(frame) {
                return !frame.isNative();
            });
            stack.forEach(function(frame) {
                var line = frame.lineNumber();
                var func = frame.functionName();
                var lib = frame.libName();
                var text = func + (lib ? " (" + lib + ")" : "")
                                + (line ? " (line " + line + ")" : "");
                $("<li/>").text(text)
                          .addClass(muteNative && frame.isNative() ? "text-muted" : "")
                          .appendTo(body);
            });

            var id = "report-stacks-" + stacks.children().length;
            clone.find(".panel-collapse")
                 .attr("id", id)
                 .addClass(append ? "" : "in");
            clone.find(".panel-heading")
                 .text(thread.name() + " stack")
                 .attr("data-target", "#" + id);
            out.add(append ? clone.appendTo(stacks)
                           : clone.prependTo(stacks));
        });
        return out;
    }

    var hideSpinner = 2;
    report.mainThread(function(threads) {
        addThreads(threads, /* append */ false);
        if (!(--hideSpinner)) {
            modal.find(".spinner-holder i").stop().fadeOut();
        }
    });
    report.backgroundThreads(function(threads) {
        addThreads(threads, /* append */ true);
        if (!(--hideSpinner)) {
            modal.find(".spinner-holder i").stop().fadeOut();
        }
    });
    modal.on("shown.bs.modal", function(event) {
        replotInfo($("#report-info-plot"), report, dimValue, sessions);
        $("#report-info-plot").prev("i.fa-spinner").stop().fadeOut();
    }).on("hidden.bs.modal", function(event) {
        $.plot($("#report-info-plot"), [[0, 0]], {grid: {show: false}});
    });
}

function replotReports(elem, reports, sessions) {
    var values = reports.dimensionValues();

    var uptimes = null;
    if (sessions) {
        var uptimeSession = sessions.byName('uptime');
        uptimes = {};
        values.forEach(function(value) {
            uptimes[value] = uptimeSession.count(value) / 60000;
        });
        values = values.filter(function(value) {
            return (uptimes[value] || 0) >= 0.1;
        });
    }
    values.sort(smartSort);

    var reports = reports.all();
    reports.sort(function(r1, r2) {
        return r1.count() - r2.count();
    });
    var otherReports = reports.slice(0, -topReports);

    var data = [{
        label: "other",
        data: values.map(function(value, index) {
            return [index, otherReports.reduce(function(prev, report) {
                return prev + report.count(value);
            }, 0) / (uptimes ? uptimes[value] : 1)];
        }),
        report: null,
    }];
    reports.slice(-topReports).forEach(function(report) {
        data.push({
            data: values.map(function(value, index) {
                return [index, report.count(value) /
                               (uptimes ? uptimes[value] : 1)];
            }),
            report: report,
        });
    });

    function _tooltip(label, xval, yval, item) {
        var num = item.series.data[item.dataIndex][1];
        var tip = values[item.dataIndex] + " : " +
                  ((!uptimes || num >= 10) ? Math.round(num) : num.toPrecision(2)) +
                  " report" + (num === 1 ? "" : "s");
        sessions && (tip += " / 1k user-hrs");
        var report = item.series.report;
        if (!report) {
            return tip;
        }
        var out = null;
        report.mainThread(function(threads) {
            var stack = "<hr>";
            var count = 0;
            threads[0].stack().every(function(frame, index) {
                if (!frame.isJava()) {
                    return true;
                }
                var line = replaceBrackets(frame.lineNumber());
                stack += (count ? "<br>" : "") +
                    replaceBrackets(frame.functionName()) +
                    (line ? " (line " + line + ")" : "");
                return (++count) < maxStackFrames;
            });
            if (out) {
                var tipelem = $("#flotTip");
                var origheight = tipelem.height();
                $("#report-plot-stack").html(stack);
                tipelem.offset({
                    top: tipelem.offset().top -
                         (tipelem.height() - origheight) / 2,
                });
            } else {
                out = stack;
            }
        });
        out = "<div id='report-plot-stack'>" + (out || "") + "</div>";
        return tip + out;
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
        colors: reportColors,
        tooltip: true,
        tooltipOpts: {
            content: _tooltip,
            onHover: _tooltipHover,
        },
    });

    elem.off("plotclick").on("plotclick", function(event, pos, item) {
        if (!item || !item.series.report) {
            return;
        }
        var modal = $("#report-modal");
        var dimValue = values[item.dataIndex];
        var report = item.series.report;
        $("#report-modal-rank").text(topReports - item.seriesIndex + 1);
        $("#report-modal-count").text(reports.length);
        $("#report-modal-dim").text(dimValue);
        $("#report-modal-id").text(report.name());
        fillReportModal(modal, report, dimValue, sessions);
        modal.modal("show");
    });
}

function replotInfo(elem, reports, value, sessions) {
    var agg = reports.infoDistribution(value);

    var uptimes = null;
    if (sessions) {
        uptimes = sessions.byName('uptime').infoDistribution(value);
        Object.keys(uptimes).forEach(function(info) {
            var uptime = uptimes[info];
            uptime[''] = Object.keys(uptime).reduce(
                function(prev, val) {
                    var v = uptime[val];
                    if (v < 600) {
                        delete uptime[val];
                    }
                    return prev + v;
                }, 0);
        });
    }

    var seriescount = 0;
    var infos = Object.keys(agg);
    infos.sort(revSmartSort);
    var data = infos.map(function(info, index) {
        var histogram = agg[info];
        var valuesarray = Object.keys(histogram);
        seriescount = Math.max(seriescount, valuesarray.length);
        valuesarray = valuesarray.map(function(value) {
            return [value, histogram[value] / (!uptimes ? 1 :
                           (uptimes[info][value] || uptimes[info]['']))];
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
                    info: [],
                });
                plotdata[i].data.push([0, series.data[1]]);
                plotdata[i].info.push(null);
            }
            plotdata[mapto] = (plotdata[mapto] || {
                data: [],
                info: [],
            });
            plotdata[mapto].data.push(series.data);
            plotdata[mapto].info.push(series.info);
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
        return replaceBrackets(item.series.info[item.dataIndex]) + " : " +
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

$("#navbar-normalize").prop("checked", false);

$("#navbar-groupby").change(function() {
    var repcount = $("#navbar-count").text(0);
    var normbtn = $("#navbar-normalize").off("change");
    var infodim = $("#info-dim-value");
    var oldinfodim = infodim.val();
    infodim.empty().off("change");

    var val = $("#navbar-groupby").val();
    if (!val) {
        $.plot($("#report-plot"), [[0, 0]], {grid: {show: true}});
        $.plot($("#info-plot"), [[0, 0]], {grid: {show: false}});
        return;
    }
    $("#info-dim-name").text(val);

    var normalize = normbtn.prop("checked");
    var reports = null;
    var sessions = null;
    function replot() {
        replotReports($("#report-plot"), reports, sessions);
        $("#report-plot").prev("i.fa-spinner").stop().fadeOut();
        infodim.trigger("change");
    }

    telemetry.reports(val, function(r) {
        reports = r;
        repcount.text(reports.cumulativeCount());

        var values = reports.dimensionValues();
        values.sort(smartSort);
        values.unshift("any");
        values.forEach(function(value) {
            infodim.append($("<option/>").text(value))
        });
        if (values.indexOf(oldinfodim) >= 0) {
            infodim.val(oldinfodim);
        } else {
            infodim[0].selectedIndex = 0;
        }
        infodim.change(function() {
            replotInfo($("#info-plot"),
                       reports,
                       infodim[0].selectedIndex == 0 ? null : infodim.val(),
                       sessions);
            $("#info-plot").prev("i.fa-spinner").stop().fadeOut();
        });
        (!normalize || sessions) && replot();
    });

    normbtn.change(function() {
        $("#report-plot").prev("i.fa-spinner").fadeIn();
        $("#info-plot").prev("i.fa-spinner").fadeIn();

        normalize = normbtn.prop("checked");
        if (normalize) {
            telemetry.sessions(val, function(s) {
                $("#report-units").text("(per 1k user-hours)");
                sessions = s;
                reports && replot();
            });
        } else {
            $("#report-units").text("");
            sessions = null;
            reports && replot();
        }
    }).trigger("change");
}).trigger("change");

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

    var groupby = $("#navbar-groupby");
    var oldgroupby = groupby.val();
    groupby.empty();

    telemetry = new ANRTelemetry();
    telemetry.init(uri, function() {
        var dims = telemetry.dimensions();
        dims.sort(smartSort);
        dims.forEach(function(dim) {
            groupby.append($("<option/>").text(dim));
        });
        groupby.val(dims.indexOf(oldgroupby) >= 0
                    ? oldgroupby
                    : defaultDimension).trigger("change");
    });
}).trigger("change");

});
