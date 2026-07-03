// allow-comment: provenance; ported from https://github.com/epologee/inbox-zero rails-app/packages/supermax, keep framework-free, hosts embed verbatim.

(function (root) {
  "use strict";

  function CellProxy(config) {
    this.config = config;
    this.actual = config.min;
  }
  Object.defineProperties(CellProxy.prototype, {
    id: { get: function () { return this.config.id; } },
    title: { get: function () { return this.config.title; } },
    min: { get: function () { return this.config.min; } },
    max: { get: function () { return this.config.max; } },
    zoomable: { get: function () { return !!this.config.zoomable; } },
    visible: { get: function () { return this.actual > 0; } },
  });

  function CellCollection(configs) {
    this.proxies = configs.map(function (config) { return new CellProxy(config); });
  }

  CellCollection.prototype.sumOfActuals = function () {
    return this.proxies.reduce(function (sum, p) { return sum + p.actual; }, 0);
  };

  CellCollection.prototype.hiddenCount = function () {
    return this.proxies.filter(function (p) { return !p.visible; }).length;
  };

  CellCollection.prototype.rightmostHiddenTitle = function () {
    for (var i = this.proxies.length - 1; i >= 0; i--) {
      if (!this.proxies[i].visible) return this.proxies[i].title;
    }
    return null;
  };

  CellCollection.prototype.resetActualsToMins = function () {
    this.proxies.forEach(function (p) { p.actual = p.min; });
  };

  CellCollection.prototype.hideCellsToFit = function (maxColumns) {
    if (this.sumOfActuals() <= maxColumns) return;
    var lastIndex = this.proxies.length - 1;
    for (var i = 0; i < this.proxies.length; i++) {
      if (i === lastIndex) {
        this.proxies[i].actual = Math.min(this.proxies[i].actual, maxColumns);
        return;
      }
      this.proxies[i].actual = 0;
      if (this.sumOfActuals() <= maxColumns) return;
    }
  };

  CellCollection.prototype.distributeRemainingSpace = function (maxColumns) {
    var visible = this.proxies.filter(function (p) { return p.visible; });
    if (visible.length === 0) return;
    var sumOfVisibleMins = visible.reduce(function (s, p) { return s + p.min; }, 0);
    if (sumOfVisibleMins > maxColumns) return;
    var sumOfVisibleMaxes = visible.reduce(function (s, p) { return s + p.max; }, 0);
    if (maxColumns >= sumOfVisibleMaxes) {
      visible.forEach(function (p) { p.actual = p.max; });
      return;
    }
    this.waterFillByWeight(visible, maxColumns);
  };

  CellCollection.prototype.waterFillByWeight = function (visible, maxColumns) {
    var fixed = new Set();
    var usedByFixed = 0;
    for (;;) {
      var active = visible.filter(function (p) { return !fixed.has(p); });
      if (active.length === 0) return;
      var remainingBudget = maxColumns - usedByFixed;
      var totalWeight = active.reduce(function (s, p) { return s + p.max; }, 0);
      var clamped = false;
      for (var i = 0; i < active.length; i++) {
        var proxy = active[i];
        var share = remainingBudget * (proxy.max / totalWeight);
        if (share < proxy.min) {
          proxy.actual = proxy.min;
          fixed.add(proxy);
          usedByFixed += proxy.min;
          clamped = true;
        } else if (share > proxy.max) {
          proxy.actual = proxy.max;
          fixed.add(proxy);
          usedByFixed += proxy.max;
          clamped = true;
        } else {
          proxy.actual = share;
        }
      }
      if (!clamped) {
        var lastActive = active[active.length - 1];
        var sumOfOthers = active.slice(0, -1).reduce(function (s, p) { return s + p.actual; }, 0);
        lastActive.actual = remainingBudget - sumOfOthers;
        return;
      }
    }
  };

  CellCollection.prototype.hideCellsBeforeAnchor = function (anchorIndex) {
    for (var i = 0; i < anchorIndex; i++) this.proxies[i].actual = 0;
  };

  CellCollection.prototype.findAnchorIndex = function (anchorId) {
    if (anchorId == null) return -1;
    for (var i = 0; i < this.proxies.length; i++) {
      if (this.proxies[i].id === anchorId) return this.proxies[i].zoomable ? i : -1;
    }
    return -1;
  };

  CellCollection.prototype.distribute = function (maxColumns, anchorId) {
    this.resetActualsToMins();
    if (this.sumOfActuals() > maxColumns) this.hideCellsToFit(maxColumns);
    var anchorIndex = this.findAnchorIndex(anchorId == null ? null : anchorId);
    if (anchorIndex > 0) this.hideCellsBeforeAnchor(anchorIndex);
    this.distributeRemainingSpace(maxColumns);
    var spareColumns = maxColumns - this.sumOfActuals();
    return {
      cells: this.proxies.map(function (p) {
        return { config: p.config, actual: p.actual, visible: p.visible };
      }),
      hiddenCount: this.hiddenCount(),
      rightmostHiddenTitle: this.rightmostHiddenTitle(),
      spareColumns: spareColumns,
    };
  };

  root.Supermax = { CellCollection: CellCollection, CellProxy: CellProxy };
})(typeof window !== "undefined" ? window : globalThis);
