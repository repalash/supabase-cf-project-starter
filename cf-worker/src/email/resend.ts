
// import {checkBlocklist} from './block-list'

export type ResendBindings = {
	RESEND_API_KEY: string;
	RESEND_API_URL?: string;
};
export type ResendSendEmailProps = {
    from: string;
    to: string[]|string;
    subject: string;
    html: string;
    tags?: { name: string; value: string }[];
};

export interface ResendProps extends Omit<ResendBindings, 'RESEND_API_KEY' | 'RESEND_WEBHOOK_SECRET'>{
    RESEND_API_KEY: string | (()=>Promise<string>)
    RESEND_WEBHOOK_SECRET?: string | (()=>Promise<string>)
}
export class ResendHelper {
    private baseUrl = 'https://api.resend.com/emails';
    private bindings: ResendProps;

    constructor(bindings: ResendProps) {
        this.bindings = bindings;
        if (bindings.RESEND_API_URL?.startsWith('https://')) this.baseUrl = bindings.RESEND_API_URL;
        else if (bindings.RESEND_API_URL) throw new Error('Invalid Resend configuration - missing')
        if (!this.bindings.RESEND_API_KEY) {
            throw new Error('Invalid Resend configuration - missing RESEND_API_KEY');
        }
        // if (!this.bindings.RESEND_WEBHOOK_SECRET) {
        //     throw new Error('Invalid Resend configuration - missing RESEND_WEBHOOK_SECRET');
        // }
    }

    async sendEmail({ from, to, subject, html, tags }: ResendSendEmailProps) {
        to = Array.isArray(to) ? to : [to];
        // to.forEach((recipient) => checkBlocklist(recipient, this.bindings.EMAIL_BLOCKLIST));

        const payload: any = { from, to, subject, html };
        if (tags) payload.tags = tags;

        const _key = this.bindings.RESEND_API_KEY
        const key = typeof _key === 'string' || !_key ? _key : await _key()

        if(!key) throw new Error('Invalid Resend configuration - missing RESEND_API_KEY')

        const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        }).catch(e=>{
            console.error('Failed to fetch resend', e)
            return new Response('Failed to fetch resend - ' + e.message || e, {status: 500})
        })
        let resJson = undefined
        let resp = ''
        try {
            resp = await res.text()
            resJson = JSON.parse(resp)
        } catch (e: any) {
            console.error('Failed to parse resend response', e)
            // resp = e?.message || e
        }
        if(!resJson || !res.ok) {
            console.error('Error sending email, ', res?.status, resp)
            // if(this.bindings.DISCORD_RESEND_NOTIFY_WEBHOOK)
                // await discordNotify(this.bindings.DISCORD_RESEND_NOTIFY_WEBHOOK, `Failed to send email(\`${res.status}\`) to \`${to}\` \n\`\`\`${resp}\`\`\``)
            throw new Error('Failed to sending email')
        }
        return resJson

    }
}