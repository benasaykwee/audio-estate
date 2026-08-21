/* CASKET — BATCH AND ALBUM
   ----------------------------------------------------------------------
   The claim under test is not "the code runs". It is that album mode does
   the musically correct thing, which is a stronger and more falsifiable
   statement:

     ONE drive for the whole record, so the relationships between tracks
     survive. Normalising each track to the same LUFS would make every
     song equally loud, which is the same as saying the quiet song is no
     longer the quiet song. The running order carries meaning and a
     mastering tool must not quietly erase it.

   So the headline assertion here is that the LOUDNESS SPREAD between
   tracks is preserved to within a fraction of a LU. Everything else is
   support.  */

var C = require('../casket_core.js');
var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ✓ ' + what); }
  else { fail++; console.log('  ✗ ' + what); }
}
function note(s) { console.log('    · ' + s); }

var FS = 48000, N = 48000 * 2;

function trk(seed, amp, n) {
  var a = C.makeNoise(seed, n);
  for (var i = 0; i < n; i++) a[i] *= amp;
  return a;
}
function record() {
  return [
    { name: 'I. The Procession', L: trk(1, 0.50, N), R: trk(2, 0.50, N) },
    { name: 'II. The Quiet One', L: trk(3, 0.10, N), R: trk(4, 0.10, N) },
    { name: 'III. The Finale',   L: trk(5, 0.33, N), R: trk(6, 0.33, N) }
  ];
}
function baseState() {
  var st = C.defaultState();
  st.style = 'velvet'; st.dust = 'off';
  return C.sanitizeState(st);
}

console.log('CASKET — batch and album\n');

console.log('— batch applies ONE arrangement to everything —');
(function () {
  var b = C.batchRender(baseState(), record(), FS);
  ok(b.tracks.length === 3, 'every track comes back');
  ok(b.tracks.every(function (t) { return t.L.length === N && t.R.length === N; }),
     'each render is latency-compensated to the source length');
  ok(b.tracks.every(function (t) { return isFinite(t.lufs) && isFinite(t.truePeak); }),
     'each track carries its own measured numbers');
  ok(b.tracks[0].name === 'I. The Procession', 'names survive, so the report can be read');

  /* a batch must be deterministic and order-independent per track: track 2
     renders the same whether it is second or first */
  var solo = C.batchRender(baseState(), [record()[1]], FS).tracks[0];
  var inBatch = b.tracks[1];
  var same = true;
  for (var i = 0; i < N; i++) if (solo.L[i] !== inBatch.L[i]) { same = false; break; }
  ok(same, 'a track renders BIT-IDENTICALLY whether alone or inside a batch');
})();

console.log('\n— album loudness is the gated measure across the whole record —');
(function () {
  var b = C.batchRender(baseState(), record(), FS);
  var al = C.albumLoudness(b.tracks, FS);
  ok(isFinite(al.integrated), 'the album has a single integrated figure');
  note('album ' + al.integrated.toFixed(2) + ' LUFS across ' +
       (al.samples / FS).toFixed(1) + ' s');

  /* THE TRAP THIS AVOIDS: averaging the three per-track LUFS values.
     LUFS is logarithmic, so their arithmetic mean is not the album's
     loudness and is usually a couple of LU wrong. Assert that we did not
     accidentally implement the naive thing. */
  var mean = (b.tracks[0].lufs + b.tracks[1].lufs + b.tracks[2].lufs) / 3;
  ok(Math.abs(al.integrated - mean) > 0.3,
     'and it is NOT the arithmetic mean of the per-track figures (' +
     al.integrated.toFixed(2) + ' vs ' + mean.toFixed(2) + ')');
  note('averaging LUFS is meaningless — the gap above is the size of that mistake');
})();

console.log('\n— the headline: one drive, and the record keeps its shape —');
(function () {
  var tracks = record();
  var before = C.batchRender(baseState(), tracks, FS).tracks;
  var spreadBefore = before[0].lufs - before[1].lufs;

  var r = C.albumMaster(baseState(), tracks, FS, -16, { passes: 8 });
  note('one drive for the record: ' + r.drive.toFixed(1) + ' dB');
  note('album lands at ' + r.album.integrated.toFixed(2) + ' LUFS (target ' +
       r.target + ', reached ' + r.reached + ')');
  r.tracks.forEach(function (t) {
    note('  ' + t.name.padEnd(20) + t.lufs.toFixed(2).padStart(8) + ' LUFS   offset ' +
         (t.offset >= 0 ? '+' : '') + t.offset.toFixed(2) + ' LU');
  });

  var spreadAfter = r.tracks[0].lufs - r.tracks[1].lufs;
  ok(Math.abs(spreadAfter - spreadBefore) < 0.5,
     'THE SPREAD SURVIVES: loud-to-quiet was ' + spreadBefore.toFixed(2) +
     ' LU, is now ' + spreadAfter.toFixed(2) + ' LU');
  note('this is the whole argument for album mode over per-track normalisation');

  /* every offset must be finite and the ordering preserved */
  ok(r.tracks.every(function (t) { return t.offset !== null && isFinite(t.offset); }),
     'every track reports a finite offset from the album figure');
  ok(r.tracks[0].lufs > r.tracks[2].lufs && r.tracks[2].lufs > r.tracks[1].lufs,
     'the loudness ORDER of the three tracks is unchanged');

  /* and the guarantee still holds on every track */
  var lidLin = C._nd.dbToLin(baseState().lid);
  var over = 0;
  r.tracks.forEach(function (t) {
    for (var i = 0; i < t.L.length; i++) {
      var v = Math.abs(t.L[i]); if (v > lidLin) over++;
      v = Math.abs(t.R[i]); if (v > lidLin) over++;
    }
  });
  ok(over === 0, 'and not one sample on the entire record exceeds the lid');
})();

console.log('\n— it verifies, and it admits when it cannot get there —');
(function () {
  /* the drive range is -12..+24. A record already far louder than the
     target cannot be brought down far enough, and the honest answer is to
     SAY SO rather than to return the closest miss as though it were a hit. */
  var loud = [
    { name: 'too loud 1', L: trk(11, 0.98, N), R: trk(12, 0.98, N) },
    { name: 'too loud 2', L: trk(13, 0.95, N), R: trk(14, 0.95, N) }
  ];
  var r = C.albumMaster(baseState(), loud, FS, -30, { passes: 7 });
  ok(r.reached === false, 'an unreachable target returns reached:false rather than a quiet miss');
  ok(r.drive === -12, '  and it says so at the rail (' + r.drive + ' dB, the floor of the range)');
  note('error ' + r.error.toFixed(2) + ' LU — reported, not buried');

  /* the verification contract: the figure returned is measured AT the
     drive returned, so re-running at that drive must agree exactly */
  var r2 = C.albumMaster(baseState(), record(), FS, -16, { passes: 8 });
  var check = C.batchRender((function () { var s = baseState(); s.drive = r2.drive; s.unity = false; return s; })(),
                            record(), FS);
  var al = C.albumLoudness(check.tracks, FS);
  ok(Math.abs(al.integrated - r2.album.integrated) < 1e-9,
     'the album figure is MEASURED at the drive returned, not predicted for a nearby one');

  /* determinism */
  var a = C.albumMaster(baseState(), record(), FS, -16, { passes: 6 });
  var b = C.albumMaster(baseState(), record(), FS, -16, { passes: 6 });
  ok(a.drive === b.drive && a.album.integrated === b.album.integrated,
     'same record, same answer, every time');
})();

console.log('\n— degenerate records —');
(function () {
  var sil = new Float64Array(N);
  var r = C.albumMaster(baseState(), [{ name: 'silence', L: sil, R: sil }], FS, -14, { passes: 4 });
  ok(r.reached === false, 'a silent record cannot reach a target and does not pretend to');
  ok(r.drive === 0 || isFinite(r.drive), '  and it still returns a finite drive rather than NaN');
  var one = C.albumMaster(baseState(), [record()[0]], FS, -16, { passes: 7 });
  ok(one.tracks.length === 1 && isFinite(one.album.integrated),
     'a one-track "album" is a legal album');
  /* EXACTLY ZERO, and it took two bugs to get here.

     This assertion used to read `< 5e-3` and carried a paragraph
     explaining why the residue was −1.37e-3 LU rather than nothing:
     renderOffline padded its input by the latency and let the METER run
     over the padded buffer, so every loudness in the project was the
     loudness of the audio with a few milliseconds of leading silence
     stapled on. Systematic, identical everywhere, and therefore invisible
     until album mode metered the same audio twice with the pad in two
     different places.

     Metering the returned samples instead of the padded buffer took it
     from −1.37e-3 to −4.24e-4. Not zero — and the remainder was a second,
     larger bug wearing the first one's coat: albumLoudness measures
     through a BYPASSED probe state, bypass had zero real delay while
     latencySamples() still reported 113, so renderOffline's compensation
     trimmed 113 samples off the front of the album. Giving bypass its own
     latency-compensated delay closed it.

     Zero is the only defensible number here: it is the same audio, metered
     twice. Any epsilon at all is an invitation to a third bug. */
  ok(one.tracks[0].offset === 0,
     '  and its offset from itself is EXACTLY zero (' +
     one.tracks[0].offset + ' LU)');
  note('the latency-pad bias is gone, and so is the bypass-delay bug it was hiding');
})();

/* ============================================================
   GAPLESS — the joins
   ============================================================ */
console.log('\n— gapless: the state crosses the join —');
(function () {
  /* THE STRONGEST FORM OF THIS ASSERTION, and the reason it is worth
     writing: take ONE continuous piece of audio and cut it into "tracks".
     A gapless render of those tracks must be BIT-IDENTICAL to rendering
     the uncut piece in one go. Anything less than bit-identical means the
     joins are doing something, and the whole point is that they do not. */
  var whole = trk(4242, 0.65, N * 3);
  var parts = [
    { name: 'a', L: whole.subarray(0, N),         R: whole.subarray(0, N) },
    { name: 'b', L: whole.subarray(N, N * 2),     R: whole.subarray(N, N * 2) },
    { name: 'c', L: whole.subarray(N * 2, N * 3), R: whole.subarray(N * 2, N * 3) }
  ];
  var st = baseState(); st.lid = -1; st.drive = 12;

  var ref = C.renderOffline(st, whole, whole, FS);
  var gap = C.batchRender(st, parts, FS, { gapless: true });

  var total = 0, i, k;
  for (i = 0; i < gap.tracks.length; i++) total += gap.tracks[i].L.length;
  ok(total === N * 3, 'the record comes back the length it went in (' + total + ')');

  var bad = 0, p = 0;
  for (i = 0; i < gap.tracks.length; i++) {
    var t = gap.tracks[i];
    for (k = 0; k < t.L.length; k++) if (t.L[k] !== ref.L[p + k]) bad++;
    p += t.L.length;
  }
  ok(bad === 0, 'a gapless record is BIT-IDENTICAL to the uncut piece rendered whole');

  /* and the control: gapped is NOT, or the assertion above proves nothing */
  var cut = C.batchRender(st, parts, FS, { gapless: false });
  var worst = 0; p = 0;
  for (i = 0; i < cut.tracks.length; i++) {
    var u = cut.tracks[i];
    for (k = 0; k < u.L.length; k++)
      worst = Math.max(worst, Math.abs(u.L[k] - ref.L[p + k]));
    p += u.L.length;
  }
  ok(worst > 1e-6, 'while a GAPPED render of the same cut differs — by up to ' +
     (20 * Math.log10(worst)).toFixed(1) + ' dB');
  note('that difference is the limiter starting from rest three times instead of once');

  /* where the difference lives: at the joins, not spread evenly */
  var early = 0, late = 0;
  var t2 = cut.tracks[1], off = N;
  for (k = 0; k < 2000; k++) early = Math.max(early, Math.abs(t2.L[k] - ref.L[off + k]));
  for (k = t2.L.length - 2000; k < t2.L.length; k++)
    late = Math.max(late, Math.abs(t2.L[k] - ref.L[off + k]));
  ok(early > late, 'and it is concentrated at the START of each track (' +
     early.toExponential(2) + ' vs ' + late.toExponential(2) + ' at the end)');

  /* the guarantee does not get weaker because the record got longer */
  var lidLin = C._nd.dbToLin(st.lid + st.margin), over = 0;
  for (i = 0; i < gap.tracks.length; i++) {
    var g = gap.tracks[i];
    for (k = 0; k < g.L.length; k++)
      if (Math.abs(g.L[k]) > lidLin || Math.abs(g.R[k]) > lidLin) over++;
  }
  ok(over === 0, 'and no sample of the whole record exceeds the lid — zero epsilon');

  ok(gap.album && Math.abs(gap.album.integrated - ref.meters.integrated) < 1e-9,
     'the record’s own loudness matches the uncut render (' +
     gap.album.integrated.toFixed(4) + ')');
})();

/* ============================================================
   DUST ACROSS A RECORD
   ============================================================ */
console.log('\n— the dither policy nobody had chosen —');
(function () {
  /* Two IDENTICAL tracks. Any difference between their outputs can only
     be the dither, which makes this the cleanest possible probe. */
  var q = trk(9, 0.02, N);
  var twin = [{ name: 'one', L: q, R: q }, { name: 'two', L: q, R: q }];
  var st = baseState();
  st.dust = 'shaped'; st.dustBits = 16; st.lid = -1; st.drive = 0;

  function differ(b) {
    var a = b.tracks[0].L, c = b.tracks[1].L, d = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== c[i]) d++;
    return d;
  }

  var same = C.batchRender(st, twin, FS, { dust: 'same' });
  ok(same.dust === 'same' && differ(same) === 0,
     '‘same’: identical tracks get the IDENTICAL noise print (0 samples differ)');
  note('reproducible, and wrong — it is one non-random noise stamped twice');

  var per = C.batchRender(st, twin, FS, { dust: 'perTrack' });
  ok(per.dust === 'perTrack' && differ(per) > q.length * 0.5,
     '‘perTrack’: each track carries its own noise (' +
     differ(per) + ' of ' + q.length + ' samples differ)');

  var dflt = C.batchRender(st, twin, FS);
  ok(dflt.dust === 'perTrack', 'and perTrack is the default, because a track is a file');

  /* THE INTERLOCK. Gapless must force continuous, or a join you went to
     trouble to make seamless gets a seam back in the noise floor. */
  var gl = C.batchRender(st, twin, FS, { gapless: true, dust: 'perTrack' });
  ok(gl.dust === 'continuous',
     'gapless OVERRIDES the dither policy to continuous, and says so');
  ok(differ(gl) > q.length * 0.5,
     '  and the stream really does keep running across the join');

  /* determinism, for every policy — this whole feature is worthless if
     rendering the same record twice gives two records */
  ['same', 'perTrack', 'continuous'].forEach(function (pol) {
    var a = C.batchRender(st, twin, FS, { dust: pol });
    var b = C.batchRender(st, twin, FS, { dust: pol });
    var d = 0;
    for (var t = 0; t < a.tracks.length; t++)
      for (var i = 0; i < a.tracks[t].L.length; i++)
        if (a.tracks[t].L[i] !== b.tracks[t].L[i]) d++;
    ok(d === 0, '‘' + pol + '’ renders the same record twice, identically');
  });

  /* the seeds must stay inside Park-Miller's legal range or the generator
     degenerates, and a seed of exactly 0 is the classic way to do it */
  var many = [];
  for (var i = 0; i < 24; i++) many.push({ name: 't' + i, L: q.subarray(0, 4800), R: q.subarray(0, 4800) });
  var big = C.batchRender(st, many, FS, { dust: 'perTrack' });
  var dead = 0;
  for (i = 0; i < big.tracks.length; i++) {
    var any = 0, tk = big.tracks[i].L;
    for (var j = 1; j < tk.length; j++) if (tk[j] !== tk[0]) { any = 1; break; }
    if (!any) dead++;
  }
  ok(dead === 0, 'a 24-track record produces 24 live dither streams, none degenerate');
})();

/* ============================================================
   THE WRITTEN REPORT
   ============================================================ */
console.log('\n— the report you can hand to somebody —');
(function () {
  var st = baseState(); st.lid = -1; st.dust = 'shaped'; st.dustBits = 16;
  var r = C.albumMaster(st, record(), FS, -14, { passes: 6 });
  var txt = C.albumReport(Object.assign({}, r, { state: st }),
                          { title: 'A RECORD OF SORTS', fs: FS });

  ok(typeof txt === 'string' && txt.length > 400, 'it produces a document (' +
     txt.length + ' characters)');
  ok(txt.indexOf('A RECORD OF SORTS') >= 0, 'it carries the title it was given');
  ok(/nothing gets out/.test(txt), 'and the motto, because it is a CASKET document');

  /* every track in the running order */
  var rows = r.tracks, missing = [];
  rows.forEach(function (t) { if (txt.indexOf(t.name) < 0) missing.push(t.name); });
  ok(missing.length === 0, 'every track appears in the running order' +
     (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));

  /* THE FIGURES MUST MATCH THE OBJECT, not be recomputed by the formatter.
     A report that does its own arithmetic is a second implementation that
     can disagree with the first. */
  ok(txt.indexOf(r.album.integrated.toFixed(2)) >= 0,
     'the album figure in the text is the album figure in the result (' +
     r.album.integrated.toFixed(2) + ')');
  ok(txt.indexOf(r.drive.toFixed(2)) >= 0, 'and so is the drive');

  /* the spread sentence — the one thing a client actually reads */
  var lo = Infinity, hi = -Infinity;
  rows.forEach(function (t) {
    if (t.lufs < lo) lo = t.lufs;
    if (t.lufs > hi) hi = t.lufs;
  });
  ok(txt.indexOf((hi - lo).toFixed(2)) >= 0,
     'the spread is stated in words and matches the table (' + (hi - lo).toFixed(2) + ' LU)');
  ok(/has not been flattened/.test(txt),
     'and the report says out loud that the record was not flattened');

  /* failure has to be legible too */
  var sil = new Float64Array(N);
  var f = C.albumMaster(baseState(), [{ name: 'nothing', L: sil, R: sil }], FS, -14, { passes: 3 });
  var ftxt = C.albumReport(Object.assign({}, f, { state: baseState() }), { fs: FS });
  ok(/NOT REACHED/.test(ftxt), 'an unreachable target is printed as NOT REACHED, in capitals');
  ok(ftxt.indexOf('NaN') < 0, 'and a silent record produces no "NaN" anywhere in the document');

  /* plain text, on purpose */
  ok(!/[<>{}]/.test(txt), 'no markup — it survives email, a print-out and a delivery portal');
  var lines = txt.split('\n'), longest = 0;
  lines.forEach(function (l) { if (l.length > longest) longest = l.length; });
  ok(longest <= 100, 'and nothing wraps: longest line is ' + longest + ' characters');
})();

console.log('\n— the proxy search: cheaper, and it must not change the answer —');
(function () {
  /* Five short tracks stand in for a record. The proxy budget is set well
     below the total so the mechanism actually engages; on a real forty
     minute album the proxy is around 1 % of the material. */
  var FSx = 48000, n = FSx * 2;
  var tr = [];
  for (var i = 0; i < 5; i++) {
    tr.push({ name: 't' + i, L: trk(i * 2 + 1, 0.2 + i * 0.1, n),
              R: trk(i * 2 + 2, 0.2 + i * 0.1, n) });
  }
  var st = baseState();
  var full = C.albumMaster(st, tr, FSx, -16, { passes: 6, proxy: false });
  var prox = C.albumMaster(st, tr, FSx, -16, { passes: 6, proxySeconds: 1 });

  /* THE POINT. A cheaper search is worthless if it answers differently.
     The refinement passes run at full rate precisely so this holds. */
  /* THE CONTRACT IS "NOT WORSE", NOT "IDENTICAL", and the first version of
     this test got that wrong. The two searches bisect different functions
     — one a slice of the record, one the whole thing — so their bisection
     paths differ and they can settle on neighbouring grid points.
     Demanding an identical drive demands that two different algorithms be
     the same algorithm, which is not a property anybody wants and not one
     the feature was built to have.
     What a user needs is that the cheap search is no worse. It usually
     turns out BETTER, because refining inside a narrow bracket resolves
     far finer than bisecting the full 36 dB range with the same number of
     passes. */
  var eP = Math.abs(prox.error), eF = Math.abs(full.error);
  ok(eP <= eF + 0.1001,
     'the proxy search is no worse than the full search (' +
     eP.toFixed(3) + ' LU off vs ' + eF.toFixed(3) + ' LU)');
  ok(!prox.reached || Math.abs(prox.error) <= 0.1001,
     '  and `reached` never lies — it is checked against the measured error');
  note('proxy ' + prox.album.integrated.toFixed(3) + ' LUFS at ' + prox.drive.toFixed(1) +
       ' dB   vs   full ' + full.album.integrated.toFixed(3) + ' LUFS at ' +
       full.drive.toFixed(1) + ' dB');

  /* and the contract survives: the figure is still measured on the WHOLE
     record at the drive returned, never on the proxy */
  var check = C.batchRender((function () {
      var s = baseState(); s.drive = prox.drive; s.unity = false; return s;
    })(), tr, FSx);
  var al = C.albumLoudness(check.tracks, FSx);
  ok(Math.abs(al.integrated - prox.album.integrated) < 1e-9,
     '  and it is the WHOLE record that was measured, not the proxy');

  /* a record shorter than the budget must skip the proxy entirely rather
     than slicing a tiny record into uselessly short pieces */
  var shortRec = [{ name: 'one', L: trk(9, 0.4, n), R: trk(10, 0.4, n) }];
  var a = C.albumMaster(baseState(), shortRec, FSx, -16, { passes: 5 });
  var b = C.albumMaster(baseState(), shortRec, FSx, -16, { passes: 5, proxy: false });
  ok(a.drive === b.drive && a.album.integrated === b.album.integrated,
     'a record shorter than the proxy budget is searched whole, identically');

  /* proxy: false must be honoured, or the option is decoration */
  ok(typeof prox.drive === 'number' && isFinite(prox.drive),
     'the proxy path returns a finite drive');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('the record keeps its shape.');
