(function () {
    "use strict";

    var minColumnWidth = 64;

    function minColumns($stackView) {
        var classes = $stackView.attr("class").split(" "),
            minVal = 1;

        for (var i = 0; i < classes.length; i++) {
            var matches = /^min\-([1-5])/.exec(classes[i]);
            if (matches !== null) {
                minVal = matches[1];
            }
        }

        return parseInt(minVal);
    }

    function maxColumns($stackView) {
        var classes = $stackView.attr("class").split(" "),
            maxVal = 0;

        for (var i = 0; i < classes.length; i++) {
            var matches = /^max\-{0,1}([0-9]+)/.exec(classes[i]);
            if (matches !== null) {
                maxVal = matches[1];
            }
        }

        return parseInt(maxVal);
    }

    function removeClassesWithPrefix($stackView, prefix, exceptClass) {
        var classes = $stackView.attr("class").split(" "),
            targetKept = false;

        exceptClass = exceptClass || "";

        for (var i = 0; i < classes.length; i++) {
            var matches = new RegExp("^(" + prefix + "\\-[0-9]+)$", "g").exec(classes[i]);
            if (matches !== null) {
                var match = matches[1];
                if (match == exceptClass) {
                    targetKept = true;
                } else {
                    $stackView.removeClass(match);
                }
            }
        }

        return targetKept;
    }

    function minColumnsAfterSettingStackVisibility(stacks,
                                                   minRequiredColumns,
                                                   maxAvailableColumns,
                                                   zoomed) {
        var diff = maxAvailableColumns - minRequiredColumns,
            missingColumns = Math.abs(diff),
            minVisibleColumns = 0;

        if (zoomed) {
            var zoomableFound;
            stacks = $(stacks.get().reverse());
            stacks.each(function (idx, stack) {
                if (!zoomableFound) {
                    stack.visible = true;
                    minVisibleColumns += stack.min;
                    if (stack.zoomable) {
                        zoomableFound = true;
                    }
                } else {
                    stack.visible = false;
                }
            });
        } else {
            stacks.each(function (idx, stack) {
                var notTheLast = idx < stacks.length - 1;

                if (missingColumns > 0 && notTheLast) {
                    stack.visible = false;
                    missingColumns -= stack.min;
                } else {
                    minVisibleColumns += stack.min;
                }
            });
        }

        return minVisibleColumns;
    }

    function distributingRemainingColumns(stacks, maxAvailableColumns, minVisibleColumns) {
        var distribute = maxAvailableColumns - minVisibleColumns,
            moreSpaceAvailable = distribute > 0,
            maxedOut = false,
            iteration = 0,
            counter,
            distributeUntilMaxedOut = function distributeUntilMaxedOut(idx, stack) {
                counter += 1;
                if (counter > iteration) {
                    maxedOut = false;
                    return;
                }
                if (stack.visible && stack.target < stack.max) {
                    maxedOut = false;
                    if (distribute > 0) {
                        stack.target += 1;
                        distribute -= 1;
                    }
                }
            };

        if (!moreSpaceAvailable) {
            return;
        }

        stacks = $(stacks.get().reverse());
        while (distribute > 0 && !maxedOut) {
            maxedOut = true;
            iteration += 1;
            counter = 0;
            stacks.each(distributeUntilMaxedOut);
        }
    }

    function StacksController(selector) {
        this.selector = null;
        this.$el = null;
        this.$hierarchy = null;
        this.$views = null;
        this.$navigation = null;
        this.$backButton = null;
        this.$zoomInButton = null;
        this.$zoomOutButton = null;
        this.zoomed = null;
        this.init(selector);
    }

    StacksController.prototype = {
        init: function init(selector) {
            var self = this;
            this.selector = selector;

            $(window).resize(function () {
                self.handleWindowResize.apply(self);
            });
        },

        update: function update() {
            this.$el = $(this.selector);
            this.$hierarchy = this.$el.find(".stacks-hierarchy");
            this.$views = this.$hierarchy.find(".stacks-view");
            this.$navigation = this.$el.find(".stacks-navigation");
            this.$backButton = this.$el.find(".stacks-navigation-view.back");
            this.$zoomInButton = this.$el.find(".stacks-navigation-view.zoom.in");
            this.$zoomOutButton = this.$el.find(".stacks-navigation-view.zoom.out");
            this.zoomed = false;

            this.handleWindowResize();
            this.setBackButtonUrl();
            this.registerZoomButtons();
        },

        handleWindowResize: function distributeAvailableSpace() {
            var availableWidth = this.$el.width(),
                maxAvailableColumns = Math.max(Math.floor(availableWidth / minColumnWidth), 5),
                minRequiredColumns = 0,
                stacks = this.$views.map(function (idx, view) {
                    var $view = $(view),
                        min = minColumns($view),
                        max = maxColumns($view);

                    minRequiredColumns += min;

                    return {
                        view: $view,
                        min: min,
                        target: min,
                        max: max,
                        visible: true,
                        zoomable: $view.attr("class").split(" ").indexOf("zoomable") >= 0
                    };
                }),
                enoughSpaceAvailable = maxAvailableColumns - minRequiredColumns >= 0,
                allVisible = !this.zoomed && enoughSpaceAvailable,
                minVisibleColumns = allVisible ? minRequiredColumns : minColumnsAfterSettingStackVisibility(
                    stacks,
                    minRequiredColumns,
                    maxAvailableColumns,
                    this.zoomed
                );

            distributingRemainingColumns(stacks, maxAvailableColumns, minVisibleColumns);

            var zoomable = this.zoomableAfterSettingVisibility(stacks);

            if (this.zoomed) {
                this.$zoomOutButton.removeClass("hidden");
            } else {
                this.$zoomOutButton.addClass("hidden");
            }

            if (zoomable && !this.zoomed) {
                this.$zoomInButton.removeClass("hidden");
            } else {
                this.$zoomInButton.addClass("hidden");
            }

            if (enoughSpaceAvailable && !this.zoomed) {
                this.$backButton.addClass("hidden");
            } else {
                this.$backButton.removeClass("hidden");
            }
        },

        zoomableAfterSettingVisibility: function zoomableAfterSettingVisibility(stacks) {
            var visibleViews = 0,
                zoomableViews = 0,
                zoomableViewIsActuallyZoomable = false,
                maxRequiredColumns = 0;

            stacks = $(stacks.get().reverse());
            stacks.each(function (idx, stack) {
                var target = stack.visible ? "visible-" + stack.target : "hidden";
                visibleViews += stack.visible ? 1 : 0;

                if (stack.visible) {
                    if (!zoomableViewIsActuallyZoomable) {
                        zoomableViews += 1;
                        if (stack.zoomable) {
                            zoomableViewIsActuallyZoomable = stack.target < stack.max;
                        }
                    }

                    maxRequiredColumns += stack.max;
                }

                stack.view.removeClass("hidden");
                if (!removeClassesWithPrefix(stack.view, "visible", target)) {
                    stack.view.addClass(target);
                }
            });

            var maxHierarchy = "max-" + maxRequiredColumns;
            if (!removeClassesWithPrefix(this.$hierarchy, "max", maxHierarchy)) {
                this.$hierarchy.addClass(maxHierarchy);
            }

            return visibleViews > 1 && zoomableViews < visibleViews && zoomableViewIsActuallyZoomable;
        },

        setBackButtonUrl: function setBackButtonUrl() {
            var rightMostUrl = $(this.$views.last()).data("url"),
                backUrl = null;

            $(this.$views.get().reverse()).each(function (idx, view) {
                var url = $(view).data("url");
                if (!backUrl && url && url != rightMostUrl) {
                    backUrl = url;
                }
            });

            if (backUrl) {
                this.$backButton.attr("href", backUrl);
            } else {
                this.$backButton.attr("href", "#");
            }
        },

        registerZoomButtons: function registerZoomButtons() {
            var self = this;
            this.$zoomInButton.on("click", function (e) {
                e.stopImmediatePropagation();
                e.preventDefault();
                self.zoomed = true;
                self.handleWindowResize.apply(self);
            });

            this.$zoomOutButton.on("click", function (e) {
                e.stopImmediatePropagation();
                e.preventDefault();
                self.zoomed = false;
                self.handleWindowResize.apply(self);
            });
        },

        toString: function () {
            return "<StacksController>";
        }
    };

    $.fn.StacksController = function StacksControllerPlugin() {
        return this.map(function (index, selector) {
            var $this = $(this),
                attr = "stacksController",
                stacksController = $this.data(attr);

            if (stacksController) {
                return stacksController;
            }

            stacksController = new StacksController(selector);
            $this.data(attr, stacksController);
            return stacksController;
        });
    };

    $(document).on("turbolinks:load", function () {
        $(".stacks").StacksController()[0].update();
    });
}());
