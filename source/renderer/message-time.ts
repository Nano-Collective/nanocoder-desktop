const months = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
];

export const untimedHistoryTitle = 'times are not saved in Nanocoder history';

const pad = (value: number) => String(value).padStart(2, '0');

function sameDay(left: Date, right: Date) {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

export function clockTime(at: number): string {
	const date = new Date(at);
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dayName(at: number, now: number): string {
	const date = new Date(at);
	if (sameDay(date, new Date(now))) return 'today';
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (sameDay(date, yesterday)) return 'yesterday';
	return `${date.getDate()} ${months[date.getMonth()]}`;
}

export function dayLabel(at: number, now: number): string {
	return `${dayName(at, now)} · ${clockTime(at)}`;
}

export function timeStamp(at: number): string {
	return new Date(at).toISOString();
}
