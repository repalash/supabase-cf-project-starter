import { ResendSendEmailProps } from './src/email/resend';

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
		// from: 'iJewel Design <onboarding@resend.dev>',
		from: 'onboarding@resend.dev',
		subject: 'Welcome',
		html: `<h1>Welcome to iJewel Design!</h1><p>Thank you for signing up. We're excited to have you on board.</p>`,
		tags: [
			{
				name: 'category',
				value: 'welcome-email',
			},
		],
	} as ResendSendEmailProps,
} as const;

export type GlobalConfig = typeof globalConfig;
