export class DiscordNotifyError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'DiscordNotifyError';
		this.status = status;
	}
}
