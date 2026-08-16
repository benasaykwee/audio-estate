// THE UNDERWORLD — analysis (FFT + log-band spectrum) for reference matching.
// A compact iterative radix-2 FFT and an averaged log-band magnitude spectrum, so the seam
// can measure a mix's tonal balance without reaching into Masterbox's brain.

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const vr = ar * cwr - ai * cwi, vi = ar * cwi + ai * cwr;
        const ur = re[i + k], ui = im[i + k];
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
      }
    }
  }
}

// Average magnitude (dB) in log bands centred on `freqs`, band edges at the log midpoints.
function averageSpectrum(L, R, fs, freqs) {
  const N = 2048, hop = 1024, win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const hi = freqs.map((f, b) => (b < freqs.length - 1 ? Math.sqrt(f * freqs[b + 1]) : fs / 2));
  const lo = freqs.map((f, b) => (b > 0 ? Math.sqrt(f * freqs[b - 1]) : f / 1.5));
  const acc = new Float64Array(freqs.length), cnt = new Float64Array(freqs.length);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let off = 0; off + N <= L.length; off += hop) {
    for (let i = 0; i < N; i++) { re[i] = 0.5 * (L[off + i] + R[off + i]) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < freqs.length; b++) {
      const i0 = Math.max(1, Math.floor(lo[b] / fs * N)), i1 = Math.min(N / 2 - 1, Math.ceil(hi[b] / fs * N));
      let e = 0, c = 0; for (let i = i0; i <= i1; i++) { e += re[i] * re[i] + im[i] * im[i]; c++; }
      if (c) { acc[b] += e / c; cnt[b] += 1; }
    }
  }
  return freqs.map((_, b) => 10 * Math.log10(acc[b] / Math.max(1, cnt[b]) + 1e-12));
}

module.exports = { fft, averageSpectrum };
