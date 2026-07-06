// ── Init ───────────────────────────────────────────────────────────────────
buildLevGrid();
installGlobalTooltips();
loadUserPrefs();
document.getElementById('dashDate').textContent = new Date().toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
