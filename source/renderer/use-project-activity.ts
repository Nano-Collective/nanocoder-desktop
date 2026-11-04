import * as React from 'react';
import {
	announcementsFor,
	type BackgroundItem,
	emptyActivity,
	reduceActivity,
} from '@/renderer/project-activity';

// Main's activity events for every project, and its requests to open one (CHAT-22).
export function useProjectActivity(onRequested: (projectId: string) => void) {
	const [state, dispatch] = React.useReducer(reduceActivity, emptyActivity);
	const requested = React.useRef(onRequested);
	requested.current = onRequested;
	React.useEffect(() => {
		const seen = new Map<string, number>();
		return window.desktop.onProjectEvent(event => {
			if (event.type === 'project-requested') {
				if (event.sequence <= (seen.get(event.projectId) ?? 0)) return;
				seen.set(event.projectId, event.sequence);
				requested.current(event.projectId);
			} else if (
				event.type === 'project-activity' ||
				event.type === 'project-removed'
			)
				dispatch(event);
		});
	}, []);
	return state;
}

// Says it once when a project in the background needs the user or has ended.
export function useBackgroundAnnouncements(
	items: readonly BackgroundItem[],
	announce: (message: string) => void,
) {
	const previous = React.useRef(new Map<string, string>());
	const latest = React.useRef(announce);
	latest.current = announce;
	React.useEffect(() => {
		for (const message of announcementsFor(previous.current, items))
			latest.current(message);
		previous.current = new Map(
			items.map(item => [item.projectId, item.status]),
		);
	}, [items]);
}
