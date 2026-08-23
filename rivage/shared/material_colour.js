// *****************************************************************************************************************************************
// Material You colour scoring - shared copy
//
// Canonical Material You scoring implementation for the RVG layout. It consolidates the
// earlier RVG staging copy; consumers include this shared file directly.
//
// Portions derived from Google Material Color Utilities.
// Copyright 2021 Google LLC. Licensed under the Apache License, Version 2.0.
// Modified and ported to panel-safe ES5 for RVG by RivaGe, 2026.
// See ../../LICENSES/Apache-2.0.txt and ../../THIRD-PARTY.md.
//
// A faithful ES5 port of the parts of Google's Material Color Utilities needed to pick a
// source colour from album art the way Android does:
//
//   CAM16   hue + chroma in a perceptually uniform appearance model
//   L*      CIELAB lightness, used as HCT's "tone"
//   Score   the ranking that turns a quantized palette into a source colour
//
// Upstream: https://github.com/material-foundation/material-color-utilities  (Apache-2.0)
// Reference: java/score/Score.java, java/hct/Cam16.java, java/utils/ColorUtils.java
//
// The Celebi quantizer (Wu + weighted k-means) is not included because Spider Monkey
// Panel's GdiBitmap.GetColourSchemeJSON already returns colour/frequency pairs. Source
// ranking therefore follows Material Score while quantization remains host-provided.
//
// Full theme roles use the same Material tone assignments with a compact CIELAB/LCh
// tone-to-sRGB solver. Google's reference HCT solver is substantially larger; LCh keeps
// this panel-safe ES5 implementation small while preserving perceptual tone, hue-linked
// neutral surfaces, automatic gamut reduction and readable foreground/background pairs.
//
// Self-contained: only uses Math/JSON. No dependency on any other file in this project.
// *****************************************************************************************************************************************

var MATERIAL_COLOUR_VERSION = "1.0.0";

// A second include must preserve the existing object: CAM16 viewing conditions are lazily
// cached on it, and shared modules follow the same guarded global convention.
var MaterialColour = (typeof MaterialColour !== "undefined" && MaterialColour &&
	MaterialColour.version) ? MaterialColour : {

	version: MATERIAL_COLOUR_VERSION,

	// ---------------------------------------------------------------- constants (Score.java)
	TARGET_CHROMA: 48.0,
	WEIGHT_PROPORTION: 0.7,
	WEIGHT_CHROMA_ABOVE: 0.3,
	WEIGHT_CHROMA_BELOW: 0.1,
	CUTOFF_CHROMA: 5.0,
	CUTOFF_EXCITED_PROPORTION: 0.01,
	FALLBACK: 0xff4285f4,   // Google Blue, upstream's fallback

	// ---------------------------------------------------------------- small maths helpers

	signum: function (x) {
		return x < 0 ? -1 : (x === 0 ? 0 : 1);
	},

	cbrt: function (x) {
		if (typeof Math.cbrt == "function")
			return Math.cbrt(x);
		return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3);
	},

	lerp: function (start, stop, amount) {
		return (1.0 - amount) * start + amount * stop;
	},

	clampDouble: function (min, max, value) {
		return value < min ? min : (value > max ? max : value);
	},

	sanitizeDegreesInt: function (degrees) {
		degrees = degrees % 360;
		if (degrees < 0)
			degrees = degrees + 360;
		return degrees;
	},

	// Shortest distance between two hue angles.
	differenceDegrees: function (a, b) {
		return 180.0 - Math.abs(Math.abs(a - b) - 180.0);
	},

	// ---------------------------------------------------------------- sRGB <-> XYZ / L*

	linearized: function (rgbComponent) {
		var normalized = rgbComponent / 255.0;
		if (normalized <= 0.040449936)
			return normalized / 12.92 * 100.0;
		return Math.pow((normalized + 0.055) / 1.055, 2.4) * 100.0;
	},

	labF: function (t) {
		var e = 216.0 / 24389.0;
		var kappa = 24389.0 / 27.0;
		if (t > e)
			return this.cbrt(t);
		return (kappa * t + 16) / 116;
	},

	labInvf: function (ft) {
		var e = 216.0 / 24389.0;
		var kappa = 24389.0 / 27.0;
		var ft3 = ft * ft * ft;
		if (ft3 > e)
			return ft3;
		return (116 * ft - 16) / kappa;
	},

	yFromLstar: function (lstar) {
		return 100.0 * this.labInvf((lstar + 16.0) / 116.0);
	},

	lstarFromY: function (y) {
		return this.labF(y / 100.0) * 116.0 - 16.0;
	},

	xyzFromArgb: function (argb) {
		var r = this.linearized((argb >> 16) & 0xff);
		var g = this.linearized((argb >> 8) & 0xff);
		var b = this.linearized(argb & 0xff);
		return [
			0.41233895 * r + 0.35762064 * g + 0.18051042 * b,
			0.2126 * r + 0.7152 * g + 0.0722 * b,
			0.01932141 * r + 0.11916382 * g + 0.95034478 * b
		];
	},

	// Perceptual lightness, 0 (black) to 100 (white). This is HCT's "tone".
	toneFromArgb: function (argb) {
		return this.lstarFromY(this.xyzFromArgb(argb)[1]);
	},

	// ---------------------------------------------------------------- CAM16 viewing conditions
	// Built once, from Material's defaults: D65 white point, background L* 50, average surround.

	viewingConditions: null,

	makeViewingConditions: function () {
		var whitePoint = [95.047, 100.0, 108.883];
		var adaptingLuminance = (200.0 / Math.PI) * this.yFromLstar(50.0) / 100.0;
		var backgroundLstar = 50.0;
		var surround = 2.0;

		var rW = whitePoint[0] * 0.401288 + whitePoint[1] * 0.650173 + whitePoint[2] * -0.051461;
		var gW = whitePoint[0] * -0.250268 + whitePoint[1] * 1.204414 + whitePoint[2] * 0.045854;
		var bW = whitePoint[0] * -0.002079 + whitePoint[1] * 0.048952 + whitePoint[2] * 0.953127;

		var f = 0.8 + surround / 10.0;
		var c = (f >= 0.9)
			 ? this.lerp(0.59, 0.69, (f - 0.9) * 10.0)
			 : this.lerp(0.525, 0.59, (f - 0.8) * 10.0);

		var d = f * (1.0 - (1.0 / 3.6) * Math.exp((-adaptingLuminance - 42.0) / 92.0));
		d = this.clampDouble(0.0, 1.0, d);
		var nc = f;

		var rgbD = [
			d * (100.0 / rW) + 1.0 - d,
			d * (100.0 / gW) + 1.0 - d,
			d * (100.0 / bW) + 1.0 - d
		];

		var k = 1.0 / (5.0 * adaptingLuminance + 1.0);
		var k4 = k * k * k * k;
		var k4F = 1.0 - k4;
		var fl = k4 * adaptingLuminance + 0.1 * k4F * k4F * this.cbrt(5.0 * adaptingLuminance);

		var n = this.yFromLstar(backgroundLstar) / whitePoint[1];
		var z = 1.48 + Math.sqrt(n);
		var nbb = 0.725 / Math.pow(n, 0.2);
		var ncb = nbb;

		var rgbAFactors = [
			Math.pow(fl * rgbD[0] * rW / 100.0, 0.42),
			Math.pow(fl * rgbD[1] * gW / 100.0, 0.42),
			Math.pow(fl * rgbD[2] * bW / 100.0, 0.42)
		];
		var rgbA = [
			400.0 * rgbAFactors[0] / (rgbAFactors[0] + 27.13),
			400.0 * rgbAFactors[1] / (rgbAFactors[1] + 27.13),
			400.0 * rgbAFactors[2] / (rgbAFactors[2] + 27.13)
		];
		var aw = (2.0 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb;

		return { n: n, aw: aw, nbb: nbb, ncb: ncb, c: c, nc: nc, rgbD: rgbD, fl: fl, z: z };
	},

	// ---------------------------------------------------------------- CAM16 hue + chroma

	hctFromArgb: function (argb) {
		if (!this.viewingConditions)
			this.viewingConditions = this.makeViewingConditions();
		var vc = this.viewingConditions;

		var xyz = this.xyzFromArgb(argb);
		var x = xyz[0], y = xyz[1], z = xyz[2];

		// XYZ -> cone responses
		var rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
		var gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
		var bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;

		// chromatic adaptation
		var rD = vc.rgbD[0] * rC;
		var gD = vc.rgbD[1] * gC;
		var bD = vc.rgbD[2] * bC;

		// post-adaptation non-linear compression
		var rAF = Math.pow(vc.fl * Math.abs(rD) / 100.0, 0.42);
		var gAF = Math.pow(vc.fl * Math.abs(gD) / 100.0, 0.42);
		var bAF = Math.pow(vc.fl * Math.abs(bD) / 100.0, 0.42);
		var rA = this.signum(rD) * 400.0 * rAF / (rAF + 27.13);
		var gA = this.signum(gD) * 400.0 * gAF / (gAF + 27.13);
		var bA = this.signum(bD) * 400.0 * bAF / (bAF + 27.13);

		// opponent channels
		var a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
		var b = (rA + gA - 2.0 * bA) / 9.0;
		var u = (20.0 * rA + 20.0 * gA + 21.0 * bA) / 20.0;
		var p2 = (40.0 * rA + 20.0 * gA + bA) / 20.0;

		var atanDegrees = Math.atan2(b, a) * 180.0 / Math.PI;
		var hue = atanDegrees < 0 ? atanDegrees + 360.0 : (atanDegrees >= 360.0 ? atanDegrees - 360.0 : atanDegrees);

		var ac = p2 * vc.nbb;
		var j = 100.0 * Math.pow(ac / vc.aw, vc.c * vc.z);

		var huePrime = (hue < 20.14) ? hue + 360 : hue;
		var eHue = 0.25 * (Math.cos(huePrime * Math.PI / 180.0 + 2.0) + 3.8);
		var p1 = 50000.0 / 13.0 * eHue * vc.nc * vc.ncb;
		var t = p1 * Math.sqrt(a * a + b * b) / (u + 0.305);
		var alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, vc.n), 0.73);
		var chroma = alpha * Math.sqrt(j / 100.0);

		return { argb: argb, hue: hue, chroma: chroma, tone: this.lstarFromY(y) };
	},

	// ---------------------------------------------------------------- Score
	// entries: [{ argb: int, population: number }, ...]
	// Returns ranked ARGB candidates, best first. Mirrors Score.score().
	score: function (entries, desired, filter) {
		desired = desired || 4;
		if (filter !== false)
			filter = true;

		var i, k;

		// ---- phase 1: HCT conversion, hue histogram
		var huePopulation = [];
		for (i = 0; i < 360; i++)
			huePopulation[i] = 0.0;

		var populationSum = 0.0;
		var colorsHct = [];
		for (i = 0; i < entries.length; i++) {
			var pop = entries[i].population;
			if (!(pop > 0))
				continue;
			var hct = this.hctFromArgb(entries[i].argb);
			colorsHct.push(hct);
			huePopulation[this.sanitizeDegreesInt(Math.floor(hct.hue))] += pop;
			populationSum += pop;
		};
		if (!colorsHct.length || populationSum <= 0)
			return [this.FALLBACK];

		// ---- phase 2: spread each hue's proportion over a 30 degree neighbourhood
		var hueExcitedProportions = [];
		for (i = 0; i < 360; i++)
			hueExcitedProportions[i] = 0.0;

		for (i = 0; i < 360; i++) {
			var proportion = huePopulation[i] / populationSum;
			for (k = i - 14; k < i + 16; k++) {
				hueExcitedProportions[this.sanitizeDegreesInt(k)] += proportion;
			};
		};

		// ---- phase 3: score and filter
		var scored = [];
		for (i = 0; i < colorsHct.length; i++) {
			var c = colorsHct[i];
			var hue = this.sanitizeDegreesInt(Math.round(c.hue));
			var prop = hueExcitedProportions[hue];
			if (filter && (c.chroma < this.CUTOFF_CHROMA || prop <= this.CUTOFF_EXCITED_PROPORTION))
				continue;

			var proportionScore = prop * 100.0 * this.WEIGHT_PROPORTION;
			var chromaWeight = (c.chroma < this.TARGET_CHROMA) ? this.WEIGHT_CHROMA_BELOW : this.WEIGHT_CHROMA_ABOVE;
			var chromaScore = (c.chroma - this.TARGET_CHROMA) * chromaWeight;
			scored.push({ hct: c, score: proportionScore + chromaScore });
		};

		scored.sort(function (x, y) {
			return y.score - x.score;
		});

		// ---- phase 4: pick up to `desired`, maximising hue separation
		var chosen = [];
		for (var diff = 90; diff >= 15; diff--) {
			chosen = [];
			for (i = 0; i < scored.length; i++) {
				var cand = scored[i].hct;
				var duplicate = false;
				for (k = 0; k < chosen.length; k++) {
					if (this.differenceDegrees(cand.hue, chosen[k].hue) < diff) {
						duplicate = true;
						break;
					};
				};
				if (!duplicate) {
					chosen.push(cand);
					if (chosen.length >= desired)
						break;
				};
			};
			if (chosen.length >= desired)
				break;
		};

		if (!chosen.length)
			return [this.FALLBACK];

		var out = [];
		for (i = 0; i < chosen.length; i++)
			out.push(chosen[i].argb);
		return out;
	},

	// ---------------------------------------------------------------- tonal palette helpers
	// These helpers use CIELAB/LCh for the tone-to-ARGB round trip. Material 3's
	// reference implementation uses HCT; LCh is used here because it is compact,
	// deterministic in Spider Monkey Panel, perceptually uniform, and supports
	// the same role/tone model. Chroma is reduced automatically at the sRGB gamut
	// boundary, preventing clipped neon backgrounds.

	labFromArgb: function (argb) {
		var xyz = this.xyzFromArgb(argb);
		var fx = this.labF(xyz[0] / 95.047);
		var fy = this.labF(xyz[1] / 100.0);
		var fz = this.labF(xyz[2] / 108.883);
		return {
			l: 116.0 * fy - 16.0,
			a: 500.0 * (fx - fy),
			b: 200.0 * (fy - fz)
		};
	},

	lchFromArgb: function (argb) {
		var lab = this.labFromArgb(argb);
		var hue = Math.atan2(lab.b, lab.a) * 180.0 / Math.PI;
		if (hue < 0) hue += 360.0;
		return {
			tone: lab.l,
			chroma: Math.sqrt(lab.a * lab.a + lab.b * lab.b),
			hue: hue
		};
	},

	delinearized: function (component) {
		var normalized = component / 100.0;
		var value = normalized <= 0.0031308
			? normalized * 12.92
			: 1.055 * Math.pow(normalized, 1.0 / 2.4) - 0.055;
		return value * 255.0;
	},

	argbFromLabUnchecked: function (l, a, b) {
		var fy = (l + 16.0) / 116.0;
		var fx = fy + a / 500.0;
		var fz = fy - b / 200.0;
		var x = 95.047 * this.labInvf(fx);
		var y = 100.0 * this.labInvf(fy);
		var z = 108.883 * this.labInvf(fz);

		var rLinear = 3.2406 * x - 1.5372 * y - 0.4986 * z;
		var gLinear = -0.9689 * x + 1.8758 * y + 0.0415 * z;
		var bLinear = 0.0557 * x - 0.2040 * y + 1.0570 * z;

		var r = this.delinearized(rLinear);
		var g = this.delinearized(gLinear);
		var blue = this.delinearized(bLinear);
		var inGamut = r >= 0 && r <= 255 && g >= 0 && g <= 255 && blue >= 0 && blue <= 255;
		return {
			argb: (0xff000000 |
				(Math.round(this.clampDouble(0, 255, r)) << 16) |
				(Math.round(this.clampDouble(0, 255, g)) << 8) |
				Math.round(this.clampDouble(0, 255, blue))) >>> 0,
			inGamut: inGamut
		};
	},

	argbFromLch: function (hue, chroma, tone) {
		hue = this.sanitizeDegreesInt(hue);
		tone = this.clampDouble(0.0, 100.0, tone);
		chroma = Math.max(0.0, chroma);
		var radians = hue * Math.PI / 180.0;
		var attempt = this.argbFromLabUnchecked(tone, Math.cos(radians) * chroma, Math.sin(radians) * chroma);
		if (attempt.inGamut) return attempt.argb;

		var low = 0.0;
		var high = chroma;
		var best = this.argbFromLabUnchecked(tone, 0, 0).argb;
		for (var i = 0; i < 14; i++) {
			var mid = (low + high) / 2.0;
			attempt = this.argbFromLabUnchecked(tone, Math.cos(radians) * mid, Math.sin(radians) * mid);
			if (attempt.inGamut) {
				best = attempt.argb;
				low = mid;
			} else {
				high = mid;
			}
		}
		return best;
	},

	toneFromSource: function (source, tone, chromaScale, maximumChroma, hueShift) {
		var lch = this.lchFromArgb(source | 0xff000000);
		var scale = chromaScale === undefined ? 1.0 : Number(chromaScale);
		var chroma = lch.chroma * (isFinite(scale) ? scale : 1.0);
		if (maximumChroma !== undefined && maximumChroma !== null)
			chroma = Math.min(chroma, Math.max(0, Number(maximumChroma) || 0));
		return this.argbFromLch(lch.hue + (Number(hueShift) || 0), chroma, tone);
	}
};
