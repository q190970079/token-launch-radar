'use strict';
/* Token Launch Radar page: renders window.RADAR_DATA, written by main.ts
   beside this dashboard in /output/data.js. No network, no framework. */
(function () {
  var data = window.RADAR_DATA || { rows: [], categories: [] };
  var rows = data.rows.slice();
  var selectedSlug = null;

  function fmt(usd) {
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(0) + 'K';
    return '$' + usd;
  }
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function el(id) { return document.getElementById(id); }

  el('stamp').textContent = 'snapshot as of ' + data.as_of + ' - ' + data.total_protocols + ' protocols';
  el('stats').innerHTML = [
    [rows.length, 'pre-token protocols ranked'],
    [data.watchlist_size, 'watchlist protocols covered'],
    [data.early_size, 'early finds below the floor'],
    [data.live_size, 'already trade / not a launch - set aside'],
    [fmt(rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0)), 'combined implied value']
  ].map(function (pair) {
    return '<div class="stat"><b>' + pair[0] + '</b><span>' + pair[1] + '</span></div>';
  }).join('');

  var catSelect = el('cat');
  data.categories.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c; opt.textContent = c; catSelect.appendChild(opt);
  });

  function visibleRows() {
    var q = el('q').value.trim().toLowerCase();
    var cat = catSelect.value;
    var scope = el('scope').value;
    var sort = el('sort').value;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (scope === 'watch' && !r.on_watchlist) return false;
      if (scope === 'early' && r.on_watchlist) return false;
      return true;
    });
    if (sort === 'tvl') out.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'growth') out.sort(function (a, b) { return (b.change_7d || -999) - (a.change_7d || -999); });
    else if (sort === 'age') out.sort(function (a, b) { return (b.age_days || -1) - (a.age_days || -1); });
    else out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function growthCell(r) {
    if (r.change_7d === null) return '<td class="num">n/a</td>';
    var cls = r.change_7d >= 0 ? 'up' : 'down';
    var sign = r.change_7d >= 0 ? '+' : '';
    return '<td class="num ' + cls + '">' + sign + r.change_7d.toFixed(1) + '%</td>';
  }
  function ageCell(r) {
    if (r.age_days === null) return '<td class="num">n/a</td>';
    if (r.age_days >= 365) return '<td class="num">' + (r.age_days / 365).toFixed(1) + 'y</td>';
    return '<td class="num">' + r.age_days + 'd</td>';
  }

  function render() {
    var list = visibleRows();
    el('count').textContent = 'showing ' + list.length + ' of ' + rows.length;
    el('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selectedSlug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span>' +
        (r.on_watchlist ? ' <span class="watch">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmt(r.tvl_usd) + '</td>' + growthCell(r) + ageCell(r) +
        '<td class="num">' + r.peer_multiple.toFixed(2) + 'x</td>' +
        '<td class="num"><strong>' + fmt(r.implied_value_usd) + '</strong></td>' +
        '<td><span class="pill ' + r.confidence + '">' + r.confidence + '</span></td></tr>';
    }).join('');
    Array.prototype.forEach.call(el('rows').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  function select(slug) {
    selectedSlug = slug;
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    el('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="meta">rank #' + r.rank + ' - ' + esc(r.category || 'Uncategorised') +
      (r.on_watchlist ? ' - on the watchlist' : ' - early find below the $50M floor') + '</div>' +
      '<dl>' +
      '<dt>Implied value</dt><dd>' + fmt(r.implied_value_usd) + '</dd>' +
      '<dt>TVL</dt><dd>' + fmt(r.tvl_usd) + '</dd>' +
      '<dt>Peer multiple</dt><dd>' + r.peer_multiple.toFixed(2) + 'x category median</dd>' +
      '<dt>7d change</dt><dd>' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + (r.listed_at || 'unreported') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || 'none listed') + '</dd>' +
      '<dt>Signal</dt><dd>' + r.confidence + '</dd>' +
      '</dl>' +
      '<p class="meta">Priced as TVL x the traded peer multiple for its category, adjusted for momentum, ' +
      'age with no token, and chain breadth. It records no token in this snapshot.</p>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>';
    render();
  }

  ['q', 'cat', 'scope', 'sort'].forEach(function (id) {
    el(id).addEventListener('input', render);
    el(id).addEventListener('change', render);
  });
  render();
  if (rows.length > 0) select(rows[0].slug);

  /* Deep links used for the entry screenshots: #detail=<slug>, #filter=<text> */
  function applyHash() {
    var hash = window.location.hash || '';
    var detail = /detail=([a-z0-9-]+)/.exec(hash);
    var filter = /filter=([a-z0-9-]+)/.exec(hash);
    if (filter) { el('scope').value = filter[1] === 'watch' ? 'watch' : 'all'; render(); }
    if (detail) select(detail[1]);
  }
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
