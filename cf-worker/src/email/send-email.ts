import {MailgunBindings, MailgunHelper} from './mailgun'
import {globalConfig} from '../config'

export type SendEmailProps = {from: string, to: string, subject: string, template: string, variables: any, tags: string[]}

export async function sendWelcomeEmail(env: MailgunBindings, email: string) {
    const helper = new MailgunHelper(env)
    const params = {...globalConfig.OTP_EMAIL_DATA} as SendEmailProps
    params.variables = {...params.variables, ...globalConfig.EMAIL_GLOBAL_VARIABLES}
    params.tags = [...params.tags, ...globalConfig.EMAIL_GLOBAL_TAGS]
    params.to = email
    // params.variables.action_text = otp
    const json = await helper.sendEmail(params)
    return json
}
