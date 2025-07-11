
import { ResendSendEmailProps } from './resend';
import welcomeMailTemplate from '../../../../email-templates/welcome.html'

export const globalConfig = {
	// EMAIL_GLOBAL_VARIABLES: {
	// 	company_name: 'iJewel3D',
	// 	company_copyright: 'iJewel3d, 2023',
	// 	company_address: '160 Robinson Road, #14-04 - Singapore - 068914',
	// 	support_email: 'contact@ijewel3d.com',
	// },
	EMAIL_GLOBAL_TAGS: [
		{
			name: 'product',
			value: 'ijewel-design',
		},
		{
			name: 'company',
			value: 'ijewel3d',
		},
	],

	WELCOME_EMAIL_DATA: {
		from: 'iJewel Design <onboarding@resend.dev>',
		subject: 'Welcome',
		html: welcomeMailTemplate,
		tags: [
			{
				name: 'category',
				value: 'welcome-email',
			},
		],
	} as ResendSendEmailProps,
} as const;

export type GlobalConfig = typeof globalConfig;
