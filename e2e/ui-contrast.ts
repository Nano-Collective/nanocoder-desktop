import {readFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {parse} from 'yaml';

type Rgb = [number, number, number];
type Pair = readonly [string, string];

export const usedPairs: readonly Pair[] = [
	['on-surface', 'surface'],
	['on-surface', 'surface-panel'],
	['on-surface', 'surface-elevated'],
	['on-surface-muted', 'surface'],
	['on-surface-muted', 'surface-panel'],
	['success', 'surface'],
	['success', 'surface-panel'],
	['warning', 'surface'],
	['warning', 'surface-elevated'],
	['error', 'surface'],
	['error', 'surface-panel'],
	['error', 'surface-elevated'],
];

const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
const colors = (
	parse(/^---\n([\s\S]*?)\n---/.exec(design)?.[1] ?? '') as {
		colors: Record<string, string>;
	}
).colors;

export const knownGaps = [
	...design.matchAll(
		/\| `([^`]+)` on `([^`]+)`[^|\n]*\| (dark|light) \| ([\d.]+):1 \|/g,
	),
].map(([, foreground, background, theme, ratio]) => ({
	foreground,
	background,
	theme,
	ratio: Number(ratio),
}));

export function rgb(hex: string): Rgb {
	return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function composite(fg: Rgb, bg: Rgb, opacity: number): Rgb {
	return fg.map((v, i) => v * opacity + bg[i] * (1 - opacity)) as Rgb;
}

export function contrast(fg: Rgb, bg: Rgb): number {
	const luminance = (values: Rgb) =>
		values
			.map(v => v / 255)
			.map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
			.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
	const a = luminance(fg);
	const b = luminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function themedColor(name: string, theme: string): Rgb {
	return rgb(colors[`${name}${theme === 'light' ? '-light' : ''}`]);
}

export function isKnownGap(fg: Rgb, bg: Rgb, theme: string): boolean {
	return knownGaps.some(
		gap =>
			gap.theme === theme &&
			JSON.stringify(fg) ===
				JSON.stringify(themedColor(gap.foreground, theme)) &&
			JSON.stringify(bg) === JSON.stringify(themedColor(gap.background, theme)),
	);
}

export async function visibleTextContrast(page: Page, theme: string) {
	const samples = await page.evaluate(() => {
		const parseColor = (color: string) =>
			color.match(/[\d.]+/g)?.map(Number) ?? [];
		const samples: {
			text: string;
			fg: [number, number, number];
			bg: [number, number, number];
		}[] = [];
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
		);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const element = node.parentElement;
			if (!element || !node.textContent?.trim()) continue;
			if (!element.checkVisibility({checkVisibilityCSS: true})) continue;
			const style = getComputedStyle(element);
			let ancestor: Element | null = element;
			let background: number[] = [];
			let opacity = 1;
			while (ancestor) {
				const parentStyle = getComputedStyle(ancestor);
				opacity *= Number(parentStyle.opacity);
				if (!background.length) {
					const color = parseColor(parentStyle.backgroundColor);
					if (color.length === 3 || color[3] === 1) background = color;
					else if (color[3] !== 0) {
						throw new Error('Add translucent-background compositing to QA');
					}
				}
				ancestor = ancestor.parentElement;
			}
			const color = parseColor(style.color);
			if (background.length < 3) throw new Error('Missing text background');
			const alpha = (color[3] ?? 1) * opacity;
			samples.push({
				text: node.textContent.trim().slice(0, 60),
				fg: color
					.slice(0, 3)
					.map((value, i) => value * alpha + background[i] * (1 - alpha)) as [
					number,
					number,
					number,
				],
				bg: background.slice(0, 3) as [number, number, number],
			});
		}
		return samples;
	});
	return samples
		.map(sample => ({...sample, ratio: contrast(sample.fg, sample.bg)}))
		.filter(
			sample => sample.ratio < 4.5 && !isKnownGap(sample.fg, sample.bg, theme),
		);
}
