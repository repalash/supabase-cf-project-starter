import {ResendBindings, ResendHelper} from './resend'
import {globalConfig} from './config'

export type ResendSendEmailProps = {
	from: string;
	to: string;
	subject: string;
	html: string;
	tags: Record<'name' | 'value', string>[];
};

export async function sendWelcomeEmail(env: ResendBindings, email: string) {
    const helper = new ResendHelper(env)
    const params = {...globalConfig.WELCOME_EMAIL_DATA} as ResendSendEmailProps
    params.tags = [...globalConfig.EMAIL_GLOBAL_TAGS, ...params.tags]
    params.to = email
    const json = await helper.sendEmail(params)
    return json
}