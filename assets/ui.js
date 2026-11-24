(() => {
  'use strict';
  const shapes = {
    'notes-board':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7v7m5-7v4m5-4v9"/>',
    activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2"/>',
    'calendar-days':'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2M8 17h2"/>',
    'chevron-left':'<path d="m14.5 6-6 6 6 6"/>','chevron-right':'<path d="m9.5 6 6 6-6 6"/>','chevron-down':'<path d="m6 9 6 6 6-6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    zap:'<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',check:'<path d="m4 12 5 5L20 6"/>',
    pencil:'<path d="m14.5 5.5 4 4M4 16l12-12a2.8 2.8 0 0 1 4 4L8 20l-5 1z"/>',
    filter:'<path d="M3 6h18M6 12h12M9 18h6"/>',timer:'<circle cx="12" cy="14" r="7.5"/><path d="M12 13.5 15 11M9 2h6M12 2v4m5 1 2-2"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    layers:'<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    'corner-down-left':'<path d="M19 5v8a2 2 0 0 1-2 2H5m5 5-5-5 5-5"/>',
    'more-horizontal':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    circle:'<circle cx="12" cy="12" r="8.5"/>','bar-chart':'<path d="M4 4v16h17M8 15v-5m5 5V6m5 9v-6"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',printer:'<path d="M7 8V3h10v5M6 17H3v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7h-3"/><path d="M7 14h10v7H7zM17 11h1"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',x:'<path d="m6 6 12 12M18 6 6 18"/>',
    flag:'<path d="M5 21V4c5-4 9 4 15 0v10c-6 4-10-4-15 0"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 .6c0 2-3 2-3 4m0 3v.1"/>',
    book:'<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-4-1-6-1-9 1-3-2-6-2-9-1zM12 6v14"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',logout:'<path d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5"/>',
    building:'<path d="M3 21h18M6 21V5l11-2v18M9 8h1m3-1h1m-5 5h1m3-1h1m-5 5h1m3-1h1"/>',
    flask:'<path d="M9 3h6m-5 0v6L4.5 18A2 2 0 0 0 6 21h12a2 2 0 0 0 1.5-3L14 9V3M7 15h10"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clipboard:'<path d="M8 5H5v16h14V5h-3"/><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 12h8m-8 4h5"/>',
    dashboard:'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="15" y="3" width="6" height="8" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    sparkles:'<path d="m13 3 2.2 6.8L22 12l-6.8 2.2L13 21l-2.2-6.8L4 12l6.8-2.2z"/>',
    folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'arrow-right':'<path d="M4 12h15m-6-6 6 6-6 6"/>','arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    'file-text':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>'
  };
  const aliases = {edit:'pencil','edit-2':'pencil','circle-check':'check-circle','check-circle-2':'check-circle','circle-help':'help','layout-dashboard':'dashboard','chart-column':'bar-chart','chart-no-axes-column':'bar-chart','trash-2':'trash','list-checks':'list','list-todo':'list',bolt:'zap','calendar-check':'calendar',briefcase:'building',settings:'filter',print:'printer',save:'check'};
  const icon=(name,size=18)=>'<svg class="j-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="'+(Number(size)||18)+'" height="'+(Number(size)||18)+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(shapes[name]||shapes[aliases[name]]||shapes.circle)+'</svg>';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.JUI={esc,icon};
})();
