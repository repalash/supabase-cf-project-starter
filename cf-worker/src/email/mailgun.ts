import {HTTPException} from 'hono/http-exception'
import {SendEmailProps} from './send-email'

export type MailgunBindings = {
    MAILGUN_API_KEY: string
    MAILGUN_API_SERVER: string
    MAILGUN_API_URL?: string
    MAILGUN_WEBHOOK_SIGNING_KEY?: string
}

export class MailgunHelper{
    baseUrl = 'https://api.mailgun.net/v3/'
    private bindings: MailgunBindings

    constructor(bindings: MailgunBindings) {
        this.bindings = bindings
        if(bindings.MAILGUN_API_URL?.startsWith('https://')) this.baseUrl = bindings.MAILGUN_API_URL
        else if(bindings.MAILGUN_API_URL) throw new HTTPException(400, {message: 'Invalid mailgun configuration'})
        if(!this.bindings.MAILGUN_API_SERVER || !this.bindings.MAILGUN_API_KEY) throw new HTTPException(400, {message: 'Invalid mailgun configuration'})
    }

    async sendEmail({from, to, subject, template, variables, tags}: SendEmailProps){
        const form = new FormData();
        form.append('from', from)
        form.append('to', to)
        form.append('subject', subject)
        form.append('template', template)
        form.append('h:X-Mailgun-Variables', JSON.stringify(variables))
        tags.forEach(tag => form.append('o:tag', tag))

        const res = await fetch(this.baseUrl + this.bindings.MAILGUN_API_SERVER + '/messages', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa('api:' + this.bindings.MAILGUN_API_KEY),
            },
            body: form
        });
        const json = await res.json() as any
        if (!res.ok || !json.id) {
            console.error('Error sending email, ', res.status, JSON.stringify(json))
            // await discordNotify(`Failed to send email(\`${res.status}\`) to \`${to}\` \n\`\`\`${JSON.stringify(json)}\`\`\``, undefined, globalConfig.DISCORD_MAILGUN_NOTIFY_WEBHOOK)
            throw new HTTPException(500, {message: 'Failed to send email'})
        }
        return json
    }
}
