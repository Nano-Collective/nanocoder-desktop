import {useCallback, useEffect, useRef, useState} from 'react';
import {
	emptyReviewState,
	ReviewController,
	type ReviewFilter,
	type ReviewState,
	type ReviewView,
} from '@/renderer/review-controller';

export function useReview(projectId: string | null, enabled: boolean) {
	const [state, setState] = useState<ReviewState>(() => emptyReviewState(null));
	const controller = useRef<ReviewController | null>(null);
	useEffect(() => {
		const next = new ReviewController(
			{
				status: request => window.desktop.review.status(request),
				diff: request => window.desktop.review.diff(request),
				agentDiff: request => window.desktop.review.agentDiff(request),
				onEvent: listener => window.desktop.files.onEvent(listener),
			},
			setState,
		);
		controller.current = next;
		return () => {
			next.dispose();
			controller.current = null;
		};
	}, []);
	useEffect(() => {
		controller.current?.select(enabled ? projectId : null);
	}, [projectId, enabled]);
	return {
		state,
		setFilter: useCallback(
			(filter: ReviewFilter) => controller.current?.setFilter(filter),
			[],
		),
		setView: useCallback(
			(view: ReviewView) => controller.current?.setView(view),
			[],
		),
		show: useCallback((path: string, staged: boolean) => {
			void controller.current?.show(path, staged);
		}, []),
		clear: useCallback(() => controller.current?.clearSelection(), []),
		refresh: useCallback(() => {
			void controller.current?.refresh();
		}, []),
	};
}
