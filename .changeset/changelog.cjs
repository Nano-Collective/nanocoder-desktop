// Each changeset's body is its changelog entry, verbatim.
async function getReleaseLine(changeset) {
	const summary = (changeset.summary || '').trim();
	if (!summary) return '';

	const isMarkdownList = /^\s*[-*]\s/.test(summary);
	const body = isMarkdownList ? summary : `- ${summary}`;

	return `\n${body}`;
}

async function getDependencyReleaseLine() {
	return '';
}

module.exports = {
	getReleaseLine,
	getDependencyReleaseLine,
	default: {getReleaseLine, getDependencyReleaseLine},
};
