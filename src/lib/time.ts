export function formatLocalTimestamp(date: Date): string {
	const pad = (value: number, length = 2) =>
		String(Math.trunc(Math.abs(value))).padStart(length, '0');
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	const seconds = pad(date.getSeconds());
	const millis = String(date.getMilliseconds()).padStart(3, '0');
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
	const offsetMins = pad(Math.abs(offsetMinutes) % 60);
	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetMins}`;
}
