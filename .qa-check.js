(() => {
  const chips = [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => t && t.startsWith('фильтр:'));
  const rows = [...document.querySelectorAll('h3, .font-mono')].map(e => e.textContent).filter(t => /^P\d\d$/.test(t));
  return JSON.stringify({ filterChip: chips[0] ?? 'none', rowCount: rows.length });
})()
