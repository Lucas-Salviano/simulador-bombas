// Teste do núcleo de cálculo (perdas de carga). Uso:  node teste-nucleo.mjs [arquivo.html]
// Extrai o bloco entre CORE-START e CORE-END do index.html e o executa isolado.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(dir, 'index.html');
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('/* CORE-START'), b = src.indexOf('/* CORE-END */');
if (a < 0 || b < 0) { console.error('Marcadores CORE-START/CORE-END não encontrados em ' + file); process.exit(2); }
const CORE = vm.runInNewContext(src.slice(a, b) + '\nCORE', {});

let pass = 0, fail = 0;
const near = (x, y, tolRel, label) => {
  const ok = Math.abs(x - y) <= tolRel * Math.max(Math.abs(y), 1e-300);
  (ok ? pass++ : fail++);
  console.log((ok ? 'ok   ' : 'FALHA') + ' ' + label + '  (obtido ' + x.toPrecision(6) + ', esperado ' + y.toPrecision(6) + ', tol ' + (tolRel * 100) + '%)');
};
const truth = (c, label) => { (c ? pass++ : fail++); console.log((c ? 'ok   ' : 'FALHA') + ' ' + label); };

// referência independente: Colebrook por bisseção em f
function colebrookBisect(Re, rr) {
  const F = f => 1 / Math.sqrt(f) + 2 * Math.log10(rr / 3.7 + 2.51 / (Re * Math.sqrt(f)));
  let lo = 1e-4, hi = 1; // F(lo)>0, F(hi)<0
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (F(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

console.log('\n[1] Escoamento laminar: f = 64/Re e identidade de Hagen-Poiseuille');
{
  const fl = { rho: 890, mu: 290 }, t = { nome: 'x', D: 50, L: 30, eps: 0.045, acc: {} };
  const r = CORE.solveTrecho(fl, 1.8, t, null);
  truth(r.ok && r.regime === 'laminar', 'regime laminar (Re = ' + r.Re.toFixed(1) + ')');
  near(r.f, 64 / r.Re, 1e-12, 'f = 64/Re');
  // Δp = 32·μ·L·v/D²  →  h = Δp/(ρ g)
  const hHP = 32 * (fl.mu / 1000) * 30 * r.v / (0.05 * 0.05) / (fl.rho * CORE.G);
  near(r.hf, hHP, 1e-9, 'hf (Darcy, f=64/Re) = Hagen-Poiseuille');
}

console.log('\n[2] Colebrook (Newton) contra bisseção independente');
for (const [Re, rr] of [[4e3, 0], [1e4, 1e-4], [1e5, 1e-3], [1e5, 0], [1e6, 0], [1e6, 5e-4], [1e7, 1e-2], [1e8, 1e-6], [2e5, 0.05]]) {
  near(CORE.colebrook(Re, rr).f, colebrookBisect(Re, rr), 1e-8, 'Re=' + Re + ' ε/D=' + rr);
}

console.log('\n[3] Valores de referência do diagrama de Moody (Colebrook)');
near(CORE.colebrook(1e6, 0).f, 0.0116, 0.01, 'tubo liso, Re = 1e6  (≈ 0,0116)');
near(CORE.colebrook(1e5, 0).f, 0.0180, 0.01, 'tubo liso, Re = 1e5  (≈ 0,0180)');
near(CORE.colebrook(1e5, 1e-3).f, 0.0222, 0.02, 'Re = 1e5, ε/D = 0,001  (≈ 0,0222)');
near(CORE.colebrook(1e7, 0.05).f, 0.0716, 0.02, 'Re = 1e7, ε/D = 0,05  (regime plenamente rugoso, ≈ 0,0716)');

console.log('\n[4] Swamee-Jain x Colebrook na faixa de validade (5e3 ≤ Re ≤ 1e8, 1e-6 ≤ ε/D ≤ 1e-2)');
{
  let worst = 0, at = '';
  for (const Re of CORE.logspace(5e3, 1e8, 40)) for (const rr of CORE.logspace(1e-6, 1e-2, 25)) {
    const d = Math.abs(CORE.swameeJain(Re, rr) - CORE.colebrook(Re, rr).f) / CORE.colebrook(Re, rr).f;
    if (d > worst) { worst = d; at = 'Re=' + Re.toExponential(2) + ', ε/D=' + rr.toExponential(1); }
  }
  truth(worst < 0.03, 'maior diferença = ' + (worst * 100).toFixed(2) + ' % (em ' + at + ') < 3 %');
}

console.log('\n[5] Exemplo conferido à mão: água 20 °C, aço comercial, D = 50 mm, L = 100 m, Q = 18 m³/h');
{
  // À mão: Q = 0,005 m³/s; A = π(0,05)²/4 = 1,9635e-3 m²; v = 2,5465 m/s; Re = 998,2·2,5465·0,05/1,002e-3 ≈ 1,2685e5
  // ε/D = 0,045/50 = 9e-4; Haaland ≈ 0,0212; v²/2g = 0,33063 m; hf = f·(L/D)·v²/2g = 0,0212·2000·0,33063 ≈ 14,0 m
  // Acessórios: entrada borda viva (0,5) + 2 curvas 90° (2×0,9) + saída (1,0) → ΣK = 3,3; hL = 3,3·0,33063 = 1,0911 m
  const fl = { rho: 998.2, mu: 1.002 };
  const t = { nome: 'ex', D: 50, L: 100, eps: 0.045, acc: { entrada: 1, c90: 2, saida: 1 } };
  const Ks = Object.fromEntries(CORE.ACCESSORIES.map(a => [a.key, a.K]));
  const r = CORE.solveTrecho(fl, 18, t, Ks);
  near(r.v, 2.5465, 1e-4, 'velocidade v (m/s)');
  near(r.Re, 1.2685e5, 2e-3, 'Reynolds');
  near(r.v2g, 0.33063, 1e-3, 'v²/(2g) (m)');
  near(r.f, colebrookBisect(r.Re, r.rr), 1e-8, 'f = Colebrook independente');
  near(r.f, 0.0212, 0.02, 'f ≈ 0,0212 (estimativa à mão por Haaland)');
  near(r.hf, r.f * 2000 * r.v2g, 1e-12, 'hf = f·(L/D)·v²/2g');
  truth(r.hf > 13.5 && r.hf < 14.5, 'hf ≈ 14,0 m  (obtido ' + r.hf.toFixed(3) + ')');
  near(r.sumK, 3.3, 1e-12, 'ΣK = 3,3');
  near(r.hL, 3.3 * 0.33063, 1e-3, 'hL = ΣK·v²/2g ≈ 1,091 m');
  near(r.h, r.hf + r.hL, 1e-12, 'h = hf + hL');
  near(r.dp, 998.2 * CORE.G * r.h, 1e-12, 'Δp = ρ·g·h');
  near(Math.abs(r.fi.diffPct) / 100, Math.abs(r.fi.fSJ - r.fi.fCol) / r.fi.fCol, 1e-12, 'diferença % Swamee-Jain/Colebrook');
}

console.log('\n[6] Regimes e transição');
{
  const fl = { rho: 1000, mu: 1 };
  const ofRe = Re => { // vazão que dá o Re desejado em D = 50 mm
    const D = 0.05, v = Re * (fl.mu / 1000) / (fl.rho * D); return v * CORE.area(D) * 3600;
  };
  const t = { nome: 'x', D: 50, L: 10, eps: 0.045, acc: {} };
  const r1 = CORE.solveTrecho(fl, ofRe(2000), t, null), r2 = CORE.solveTrecho(fl, ofRe(3000), t, null), r3 = CORE.solveTrecho(fl, ofRe(1e5), t, null);
  truth(r1.regime === 'laminar' && Math.abs(r1.Re - 2000) < 1e-6, 'Re = 2000 → laminar');
  truth(r2.regime === 'transicao' && r2.warnings.some(w => /transição/.test(w)), 'Re = 3000 → transição, com aviso');
  near(r2.f, Math.max(64 / 3000, CORE.colebrook(3000, 0.0009).f), 1e-12, 'transição: f = máx(64/Re, Colebrook)');
  truth(r3.regime === 'turbulento', 'Re = 1e5 → turbulento');
  truth(CORE.regimeOf(2300) === 'transicao' && CORE.regimeOf(4000) === 'turbulento' && CORE.regimeOf(2299.9) === 'laminar', 'fronteiras 2300 e 4000');
}

console.log('\n[7] Validações de entrada');
{
  const fl = { rho: 1000, mu: 1 }, ok = { nome: 'x', D: 50, L: 10, eps: 0.05, acc: {} };
  truth(!CORE.solveTrecho(fl, 0, ok, null).ok, 'Q = 0 recusada');
  truth(!CORE.solveTrecho(fl, -5, ok, null).ok, 'Q negativa recusada');
  truth(!CORE.solveTrecho(fl, 10, Object.assign({}, ok, { D: 0 }), null).ok, 'D = 0 recusado');
  truth(!CORE.solveTrecho(fl, 10, Object.assign({}, ok, { L: -1 }), null).ok, 'L negativo recusado');
  truth(!CORE.solveTrecho(fl, 10, Object.assign({}, ok, { eps: -1 }), null).ok, 'ε negativa recusada');
  truth(!CORE.solveTrecho(fl, 10, Object.assign({}, ok, { eps: 60 }), null).ok, 'ε ≥ D recusada');
  truth(!CORE.solveTrecho({ rho: 0, mu: 1 }, 10, ok, null).ok, 'ρ = 0 recusada');
  truth(!CORE.solveTrecho({ rho: 1000, mu: 0 }, 10, ok, null).ok, 'μ = 0 recusada');
  truth(CORE.solveTrecho(fl, 10, Object.assign({}, ok, { eps: 3 }), null).warnings.some(w => /Moody/.test(w)), 'ε/D > 0,05 gera aviso');
  truth(CORE.solveTrecho(fl, 400, ok, null).warnings.some(w => /3 m\/s/.test(w)), 'v > 3 m/s gera aviso');
}

console.log('\n[8] Trechos em série, energia, Hazen-Williams');
{
  const fl = { rho: 998.2, mu: 1.002 };
  const Ks = Object.fromEntries(CORE.ACCESSORIES.map(a => [a.key, a.K]));
  const ts = [{ nome: 'A', D: 75, L: 60, eps: 0.0015, acc: { entrada: 1, c90: 2 } }, { nome: 'B', D: 50, L: 40, eps: 0.0015, acc: { c90: 1, saida: 1 } }];
  const s = CORE.solveSystem(fl, 18, ts, Ks);
  const a = CORE.solveTrecho(fl, 18, ts[0], Ks), b = CORE.solveTrecho(fl, 18, ts[1], Ks);
  near(s.h, a.h + b.h, 1e-12, 'h_total = soma dos trechos');
  near(s.hf + s.hL, s.h, 1e-12, 'hf_total + hL_total = h_total');
  truth(b.v > a.v, 'velocidade maior no trecho de menor diâmetro');
  const p = CORE.pumpPower(fl, 18, s.h, 0.7, 0.92);
  near(p.Phyd, 998.2 * CORE.G * 0.005 * s.h / 1000, 1e-12, 'potência hidráulica ρ·g·Q·h');
  near(p.Pelec, p.Phyd / 0.7 / 0.92, 1e-12, 'potência elétrica');
  const e = CORE.annualEnergy(2, 8, 300, 0.8); near(e.cost, 2 * 8 * 300 * 0.8, 1e-12, 'custo anual de energia');
  // Hazen-Williams: mesma ordem de grandeza do Darcy-Weisbach para água em PVC
  const dw = CORE.solveTrecho(fl, 18, { nome: 'p', D: 50, L: 100, eps: 0.0015, acc: {} }, null).hf;
  const hw = CORE.hazenWilliams(18, 50, 100, 150);
  truth(Math.abs(hw - dw) / dw < 0.2, 'Hazen-Williams (C = 150) ≈ Darcy (PVC): ' + hw.toFixed(2) + ' m x ' + dw.toFixed(2) + ' m');
}

console.log('\n[9] Moody, diâmetro econômico e "o que mudar"');
{
  const c = CORE.moodyCurve(1e-3, 40);
  truth(c.every((p, i) => i === 0 || p.y <= c[i - 1].y + 1e-12), 'curva de Moody decrescente com Re');
  const fl = { rho: 998.2, mu: 1.002 };
  const ec = CORE.economicDiameter({ fl, Q: 36, L: 200, eps: 0.0015, sumK: 5, etaB: 0.7, etaM: 0.92, hDia: 8, dias: 300, tarifa: 0.8, c100: 60, n: 1.4, fa: 0.15 });
  truth(ec.best > 0 && ec.best < ec.rows.length - 1, 'diâmetro econômico interior à lista: ' + ec.rows[ec.best].D + ' mm');
  const Ks = Object.fromEntries(CORE.ACCESSORIES.map(a => [a.key, a.K]));
  const w = CORE.whatToChange(fl, 18, [{ nome: 'A', D: 50, L: 50, eps: 0.26, acc: { globo: 1, c90: 2, saida: 1 } }], Ks);
  truth(w.contrib[0].h >= w.contrib[w.contrib.length - 1].h, 'contribuições ordenadas');
  truth(Math.abs(w.contrib.reduce((s, c) => s + c.share, 0) - 100) < 1e-9, 'participações somam 100 %');
  truth(w.tests.length >= 2 && w.tests[0].saving >= w.tests[w.tests.length - 1].saving && w.tests[0].saving > 0, 'melhorias testadas, da maior para a menor economia');
}

console.log('\n[10] Leitura de números e memória de cálculo');
{
  truth(CORE.parseNum('1,5') === 1.5 && CORE.parseNum('1.5') === 1.5 && CORE.parseNum('1.234,5') === 1234.5 && CORE.parseNum(' 2e-3 ') === 0.002, 'parseNum aceita vírgula e ponto');
  truth(Number.isNaN(CORE.parseNum('abc')) && Number.isNaN(CORE.parseNum('')), 'parseNum recusa texto e vazio');
  const fl = { rho: 998.2, mu: 1.002 };
  const t = { nome: 'ex', D: 50, L: 100, eps: 0.045, acc: { entrada: 1 } };
  const r = CORE.solveTrecho(fl, 18, t, {});
  const m = CORE.memoryTrecho(fl, 18, t, r, 0, 1);
  truth(/Re = /.test(m) && /Colebrook/.test(m) && /Swamee-Jain/.test(m) && /hf = /.test(m) && /hL = /.test(m), 'memória contém Re, Colebrook, Swamee-Jain, hf e hL');
}

console.log('\n' + pass + ' verificações ok, ' + fail + ' falhas.');
process.exit(fail ? 1 : 0);
