import {useCallback, useEffect, useRef, useState} from 'react';
import {
	BrowserController,
	type BrowserState,
} from '@/renderer/browser-controller';
import type {BrowserBounds, BrowserNavigation} from '@/shared/browser';

export function useBrowser(projectId: string | null) {
	const [state, setState] = useState<BrowserState | null>(null);
	const controller = useRef<BrowserController | null>(null);
	useEffect(() => {
		const model = new BrowserController(window.desktop, setState);
		controller.current = model;
		return () => {
			model.dispose();
			if (controller.current === model) controller.current = null;
		};
	}, []);
	useEffect(() => {
		void controller.current?.select(projectId);
	}, [projectId]);
	const current = state?.projectId === projectId ? state : null;
	return {
		snapshot: current?.snapshot ?? null,
		publicSites: current?.publicSites ?? false,
		loading: current?.loading ?? true,
		pending: current?.pending ?? false,
		error: current?.error ?? null,
		open: (input: string) =>
			controller.current?.open(input) ?? Promise.resolve(false),
		navigate: (action: BrowserNavigation) => {
			void controller.current?.navigate(action);
		},
		setPublicSites: (enabled: boolean) => {
			void controller.current?.setPublicSites(enabled);
		},
		allowAndOpen: (url: string) => {
			void controller.current?.allowAndOpen(url);
		},
		setBounds: useCallback((bounds: BrowserBounds | null) => {
			controller.current?.setBounds(bounds);
		}, []),
	};
}
