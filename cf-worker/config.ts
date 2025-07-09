
import {SendEmailProps} from './src/email/send-email'

export const globalConfig = {
	EMAIL_GLOBAL_VARIABLES: {
		company_name: 'iJewel3D',
		company_copyright: 'iJewel3d, 2023',
		company_address: '160 Robinson Road, #14-04 - Singapore - 068914',
		support_email: 'contact@ijewel3d.com',
	},
	EMAIL_GLOBAL_TAGS: ['ijewel-design', 'ijewel3d'],

	// email otp
	OTP_EMAIL_RESEND_THRESH: 60 * 2, // 2 min
	OTP_EMAIL_EXPIRY: 60 * 10, // 10 min
	// OTP_EMAIL_RESEND_THRESH: 1, // testing
	// OTP_EMAIL_EXPIRY: 1, // testing

	OTP_EMAIL_DATA: {
		from: 'iJewel Design <noreply@mail.ijewel3d.com>',
		subject: 'Welcome',
		template: 'welcome-email', // https://app.mailgun.com/app/sending/domains/mail.ijewel3d.com/templates/details/ZW1haWwgdmVyaWZpY2F0aW9uIGNvZGU%3D
		variables: {
			message_description: 'user welcome description',
			message_footer: 'out product link',
			message_title: 'Welcome',
			action_text: 'Something went wrong...', // this will be replaced with OTP
		},
		tags: ['welcome-email', 'ijewel-design'],
	} as SendEmailProps,
} as const;

export type GlobalConfig = typeof globalConfig