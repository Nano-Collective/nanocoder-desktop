import * as React from 'react';
import {Card} from '@/renderer/ui';

export interface ProjectFeedback {
	status: 'ready' | 'untrusted' | 'failed' | 'cancelled';
	message: string;
}

export function TrustFeedback({
	feedback,
}: {
	feedback: ProjectFeedback | null;
}): React.ReactElement | null {
	if (!feedback) return null;
	const failed =
		feedback.status === 'failed' || feedback.status === 'untrusted';
	return (
		<Card
			className="project-trust-feedback"
			variant={failed ? 'failure' : 'default'}
			role={failed ? 'alert' : 'status'}
			aria-label="project trust feedback"
		>
			<p>
				<span aria-hidden="true">
					{failed ? '✕' : feedback.status === 'ready' ? '✓' : '○'}{' '}
				</span>
				{feedback.message}
			</p>
		</Card>
	);
}
