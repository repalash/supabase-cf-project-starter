export type MailgunBindings = {
    MAILGUN_API_KEY: string
    MAILGUN_API_SERVER: string
    MAILGUN_API_URL?: string
    MAILGUN_WEBHOOK_SIGNING_KEY?: string
}
export type MailgunSendEmailProps = {
    from: string
    to: string
    subject: string
    template: string
    variables: any
    tags: string[]
}

export class MailgunHelper{
    baseUrl = 'https://api.mailgun.net/v3/'
    private bindings: MailgunBindings

    constructor(bindings: MailgunBindings) {
        this.bindings = bindings
        if(bindings.MAILGUN_API_URL?.startsWith('https://')) this.baseUrl = bindings.MAILGUN_API_URL
        else if(bindings.MAILGUN_API_URL) throw Error('Invalid mailgun configuration')
        if(!this.bindings.MAILGUN_API_SERVER || !this.bindings.MAILGUN_API_KEY) throw Error('Invalid mailgun configuration')
    }

    async sendEmail({from, to, subject, template, variables, tags}: MailgunSendEmailProps){
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
            throw new Error('Failed to sending email')
        }
        return json
    }
}
