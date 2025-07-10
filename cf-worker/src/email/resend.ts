export type ResendBindings = {
	RESEND_API_KEY: string;
	RESEND_API_URL?: string;
};
export type ResendSendEmailProps = {
	from: string;
	to: string;
	subject: string;
	html: string;
	tags: Record<'name' | 'value', string>[];
};

export class ResendHelper {
	baseUrl = 'https://api.resend.com/emails';
	private bindings: ResendBindings;

	constructor(bindings: ResendBindings) {
		this.bindings = bindings;
		if (bindings.RESEND_API_URL) this.baseUrl = bindings.RESEND_API_URL;
		if (!bindings.RESEND_API_KEY) throw Error('Invalid mailgun configuration');
	}

	async sendEmail({ from, to, subject, html, tags }: ResendSendEmailProps) {
		const params = { from, to, subject, html, tags };
		console.log(this.baseUrl, this.bindings.RESEND_API_KEY, { from, to, subject, html, tags });
		const res = await fetch(this.baseUrl, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer ' + this.bindings.RESEND_API_KEY,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(params),
		});

		const json = (await res.json()) as any;
		if (!res.ok || !json.id) {
			console.error('Error sending email, ', res.status, JSON.stringify(json));
			throw new Error('Failed to sending email');
		}
		return json;
	}
}
