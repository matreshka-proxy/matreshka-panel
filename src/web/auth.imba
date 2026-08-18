import {t} from './i18n.imba'
import {fmt, webauthn} from './context.imba'

tag matreshka-auth-shell
	mode = 'setup'
	copied = false

	get story
		if mode == 'preflight'
			return {
				badge: t('setup.story.badge')
				title: t('setup.story.title')
				subtitle: t('setup.story.subtitle')
				points: [
					{icon: 'activity', text: t('setup.story.running')}
					{icon: 'shield-check', text: t('setup.story.secure')}
					{icon: 'browser', text: t('setup.story.browser')}
				]
			}
		const prefix = mode == 'setup' ? 'onboarding' : 'auth'
		const points = [
			{icon: 'browser', text: t('auth.story.web')}
			{icon: 'plugs-connected', text: t('auth.story.protocols')}
			{icon: 'device-mobile', text: t('auth.story.clients')}
			{icon: 'arrows-clockwise', text: t('onboarding.story.updates')}
			{icon: 'lightning', text: t('auth.story.speed')}
			{icon: 'arrows-left-right', text: t('auth.story.transfer')}
			{icon: 'fingerprint-simple', text: t('onboarding.story.device')}
		]
		{
			badge: t("{prefix}.story.badge")
			title: t("{prefix}.story.title")
			subtitle: t("{prefix}.story.subtitle")
			points: points
		}

	def copy
		const root = window.location.pathname.split('/').filter(Boolean)[0] or 'admin'
		await window.navigator.clipboard.writeText("{window.location.origin}/{root}/")
		copied = true
		imba.commit!

	<self .preflight=(mode == 'preflight')>
		<aside>
			<matreshka-logo>
			<div.story>
				<span.eyebrow> story.badge
				<h2> story.title
				<p> story.subtitle
				<ul>
					for point in story.points
						<li>
							<matreshka-icon name=point.icon>
							<span> point.text
			<div.host>
				<matreshka-icon name="globe-hemisphere-west">
				<div>
					<small> copied ? t('auth.host.copied') : (mode == 'preflight' ? t('setup.host') : t('auth.host'))
					<span> window.location.host
				<button.copy type="button" @click=copy aria-label=(copied ? t('auth.host.copied') : t('auth.host.copy')) title=(copied ? t('auth.host.copied') : t('auth.host.copy'))>
					<matreshka-icon name=(copied ? 'check' : 'copy')>
		<main>
			<slot>

	css self
		mih:100vh d:grid gtc:minmax(340px, .86fr) minmax(0, 1.34fr) bgc:white
		aside
			d:flex fld:column p:clamp(36px, 5vw, 72px) bg:linear-gradient(145deg, var(--matreshka-auth-start), var(--matreshka-auth-end))
			matreshka-logo margin-bottom:clamp(72px, 13vh, 140px)
			.story maw:480px
			.eyebrow d:block mb:20px c:var(--matreshka-brand) fs:12px fw:750 ls:.09em tt:uppercase
			h2 c:var(--matreshka-navy) fs:clamp(32px, 3.4vw, 50px) lh:1.08 ls:-.035em
			p mt:24px c:var(--matreshka-muted) fs:17px lh:1.65
			ul d:grid g:16px mt:36px p:0 list-style:none
			li d:flex ai:center g:12px c:var(--matreshka-text) fs:15px fw:650
			li matreshka-icon s:34px d:grid ja:center rd:10px bgc:white c:var(--matreshka-brand) fs:18px bxs:0 8px 24px black/6
			.host d:flex ai:center g:11px mt:auto pt:48px c:var(--matreshka-muted)
			.host matreshka-icon c:var(--matreshka-success) fs:19px
			.host > div fl:1 min-width:0
			.host small, .host span d:block
			.host small mb:3px fs:10px fw:750 ls:.06em tt:uppercase
			.host span fs:13px
			.host .copy s:36px d:grid ja:center ml:auto bd:1px solid var(--matreshka-line) rd:10px bgc:white c:var(--matreshka-brand)
			.host .copy matreshka-icon c:inherit fs:17px
			.host .copy@hover bgc:var(--matreshka-auth-start)
		main d:grid place-items:center p:clamp(28px, 6vw, 84px)
		&.preflight main p:32px clamp(28px, 6vw, 84px)
		@media(max-width: 820px)
			gtc:1fr gtr:auto 1fr
			aside p:24px 22px
			aside matreshka-logo m:0
			aside .story, aside .host d:none
			main p:44px 20px 56px place-items:center

tag matreshka-login
	store = null
	busy = false
	message = null

	def login
		busy = true
		message = null
		try
			const start = await store.api('POST', '/api/v1/auth/login/options', {})
			const credential = await window.navigator.credentials.get({publicKey: webauthn.decode(start.options)})
			await store.api('POST', '/api/v1/auth/login/verify', {challengeId: start.challengeId, response: webauthn.json(credential)})
			store.goto('/')
			await store.load!
		catch issue
			message = issue.message
		finally
			busy = false
			imba.commit!

	<self>
		<matreshka-auth-shell mode="login">
			<section.auth-panel.login-panel>
				<span.panel-badge> t('auth.badge')
				<h1> t('auth.title')
				<p> t('auth.subtitle')
				if message
					<div.matreshka-error> message
				<button.matreshka-button disabled=busy @click=login>
					<matreshka-icon name=(busy ? 'spinner-gap' : 'fingerprint')>
					<span> busy ? t('auth.wait') : t('auth.button')
				<div.trust>
					<matreshka-icon name="shield-check">
					<span> t('auth.secure')
				<details.recovery>
					<summary> t('auth.recovery.title')
					<p> t('auth.recovery.subtitle')
					<code> 'sudo matreshkactl bootstrap-reset'

	css self
		.auth-panel maw:480px
		.panel-badge d:block mb:26px c:var(--matreshka-brand) fs:12px fw:750 ls:.08em tt:uppercase
		h1 c:var(--matreshka-navy) fs:38px lh:1.14 ls:-.025em
		.auth-panel > p mt:14px c:var(--matreshka-muted) fs:17px lh:1.6
		.auth-panel > .matreshka-error mt:22px
		.auth-panel > .matreshka-button w:100% mt:30px
		.auth-panel > .matreshka-button matreshka-icon.ph-spinner-gap animation:spin 1s linear infinite
		.trust d:flex ai:flex-start g:9px mt:18px c:var(--matreshka-muted) fs:13px lh:1.45
		.trust matreshka-icon mt:2px c:var(--matreshka-success) fs:17px
		.recovery mt:32px pt:24px border-top:1px solid var(--matreshka-line) c:var(--matreshka-muted) fs:13px
		.recovery summary cursor:pointer c:var(--matreshka-text) fw:650
		.recovery p mt:12px lh:1.55
		.recovery code d:block mt:12px p:11px 13px rd:9px bgc:var(--matreshka-soft) c:var(--matreshka-text) fs:12px
		@media(max-width: 560px)
			h1 fs:32px

tag matreshka-setup
	store = null
	step = 0
	direction = 1
	source = ''
	free = ''
	own = ''
	domain = ''
	server = ''
	preview = false
	loading = true
	busy = false
	copied = false
	help = false
	message = null
	onboarding = null

	def setup
		const params = new URLSearchParams(window.location.search)
		const hostname = window.location.hostname
		preview = params.get('bootstrap') == 'preview'
		if preview
			server = params.get('ip') or '203.0.113.42'
		else
			server = params.get('ip') or (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ? hostname : '203.0.113.42')
		loading = !preview

	def mount
		load! unless preview

	def load
		try
			const bootstrap = new URLSearchParams(window.location.search).get('bootstrap')
			const state = await store.api('GET', "/api/v1/setup?bootstrap={window.encodeURIComponent(bootstrap or '')}")
			server = state.publicIp
		catch issue
			message = issue.message
		finally
			loading = false
			imba.commit!

	get providers
		[
			{name: 'DuckDNS', note: t('setup.domain.duckdns'), url: 'https://www.duckdns.org/', featured: true}
			{name: 'FreeMyIP', note: t('setup.domain.freemyip'), url: 'https://freemyip.com/'}
			{name: 'dynv6', note: t('setup.domain.dynv6'), url: 'https://dynv6.com/'}
		]

	get field
		if source == 'free'
			return {label: t('setup.domain.label_free'), placeholder: t('setup.domain.placeholder_free')}
		{label: t('setup.domain.label_own'), placeholder: t('setup.domain.placeholder_own')}

	get entry do source == 'free' ? free : own

	get address
		try
			let value = entry.trim!.toLowerCase!
			return '' unless value
			value = "https://{value}" unless value.includes('://')
			new URL(value).hostname
		catch
			''

	get valid? do address.includes('.') and !address.endsWith('.')
	get blocked? do busy or !valid?
	get record do valid? ? address : field.placeholder

	def move next, vector
		direction = vector
		step = next

	def advance
		move 1, 1 if source

	def back
		move Math.max(0, step - 1), -1

	def copy
		await window.navigator.clipboard.writeText(server)
		copied = true
		imba.commit!

	def clean
		return unless valid?
		if source == 'free'
			free = address
		else
			own = address

	def toggle
		help = !help

	def verify
		return unless valid?
		domain = address
		busy = true
		message = null
		try
			if preview
				await new Promise do(resolve) window.setTimeout(resolve, 900)
			else
				const bootstrap = new URLSearchParams(window.location.search).get('bootstrap')
				const result = await store.api('POST', '/api/v1/setup/domain', {bootstrapToken: bootstrap, domain: domain})
				domain = result.domain
				onboarding = result.onboardingUrl
				await new Promise do(resolve) window.setTimeout(resolve, 2200)
			move 2, 1
		catch issue
			message = issue.message
		finally
			busy = false
			imba.commit!

	def open_owner
		if onboarding
			window.location.assign(onboarding)
			return
		const bootstrap = new URLSearchParams(window.location.search).get('bootstrap')
		const query = bootstrap ? "?bootstrap={window.encodeURIComponent(bootstrap)}" : ''
		store.goto("/onboarding{query}")

	<self>
		<matreshka-auth-shell mode="preflight">
			<section.auth-panel.setup-panel .backwards=(direction < 0)>
				if loading
					<div.step.loading-step>
						<matreshka-icon name="spinner-gap">
				elif message and step == 0
					<div.step.error-step>
						<div.matreshka-error> message
						<button.matreshka-button @click=load>
							<matreshka-icon name="arrows-clockwise">
							<span> 'Повторить'
				elif step == 0
					<form.step.choice-step [o@off:0 ease:340ms] ease @submit.prevent=advance>
						<span.panel-badge> t('setup.badge')
						<h1> t('setup.domain.title')
						<p> t('setup.domain.subtitle')
						<div.sources>
							<label.source .selected=(source == 'free')>
								<input type="radio" bind=source value="free">
								<matreshka-icon name="gift">
								<div>
									<strong> t('setup.domain.free')
									<small> t('setup.domain.free_hint')
									<p> t('setup.domain.free_detail')
								<span.choice-mark><matreshka-icon name="check">
							<label.source .selected=(source == 'own')>
								<input type="radio" bind=source value="own">
								<matreshka-icon name="globe-hemisphere-west">
								<div>
									<strong> t('setup.domain.own')
									<small> t('setup.domain.own_hint')
									<p> t('setup.domain.own_detail')
								<span.choice-mark><matreshka-icon name="check">
						<button.matreshka-button type="submit" disabled=!source>
							<span> t('setup.domain.continue')
							<matreshka-icon name="arrow-right">
				elif step == 1
					<form.step.configure-step [o@off:0 ease:340ms] ease @submit.prevent=verify>
						<div.progress>
							<span> t('setup.configure.progress')
							<div.dots>
								<i.active>
								<i.active>
								<i>
						<button.back type="button" @click=back>
							<matreshka-icon name="arrow-left">
							<span> t('onboarding.back')
						if source == 'free'
							<h1> t('setup.free.title')
							<p> t('setup.free.subtitle')
							<div.free-box>
								<div.guide>
									<strong> t('setup.domain.service')
									<small> t('setup.domain.service_hint')
								<div.catalog>
									for provider in providers
										<a href=provider.url target="_blank" rel="noopener noreferrer">
											<span>
												<strong> provider.name
												<em> t('setup.domain.recommended') if provider.featured
											<small> provider.note
											<matreshka-icon name="arrow-square-out">
								<div.server-ip>
									<span> preview ? t('setup.domain.server_preview') : t('setup.domain.server')
									<strong> server
									<button type="button" @click=copy aria-label=(copied ? t('setup.dns.copied') : t('setup.dns.copy'))>
										<matreshka-icon name=(copied ? 'check' : 'copy')>
							<label.matreshka-field.domain-field>
								<span> field.label
								<input bind=free @blur=clean autofocus autocomplete="url" placeholder=field.placeholder>
						else
							<h1> t('setup.own.title')
							<p> t('setup.own.subtitle')
							<label.matreshka-field.domain-field>
								<span> field.label
								<input bind=own @blur=clean autofocus autocomplete="url" placeholder=field.placeholder>
							<div.record-guide>
								<strong> t('setup.own.record')
								<div.dns-card>
									<div.record>
										<small> t('setup.dns.type')
										<strong> 'A'
									<div.record>
										<small> t('setup.dns.name')
										<strong> record
									<div.record>
										<small> t('setup.dns.value')
										<strong.mono> server
										<button.copy-value type="button" @click=copy>
											<matreshka-icon name=(copied ? 'check' : 'copy')>
											<span> copied ? t('setup.dns.copied') : t('setup.dns.copy')
								<p.provider> t('setup.own.record_hint')
							<div.netlify .expanded=help>
								<button.netlify-head type="button" @click=toggle aria-expanded=help>
									<matreshka-icon name="cloud">
									<span> t('setup.own.netlify')
									<matreshka-icon.chevron name="caret-down">
								<div.netlify-body .open=help>
									<div.netlify-content>
										<p> t('setup.own.netlify_hint')
										<a href="https://docs.netlify.com/manage/domains/set-up-netlify-dns/" target="_blank" rel="noopener noreferrer">
											<span> t('setup.own.netlify_link')
											<matreshka-icon name="arrow-square-out">
						<div.waiting>
							<matreshka-icon name="clock">
							<span> t('setup.dns.waiting')
						if message
							<div.matreshka-error> message
						<button.matreshka-button type="submit" disabled=blocked?>
							<matreshka-icon name=(busy ? 'spinner-gap' : 'arrows-clockwise')>
							<span> busy ? t('setup.dns.checking') : t('setup.dns.check')
						<div.notice>
							<matreshka-icon name="info">
							<span> t('setup.domain.note')
				else
					<div.step.complete [o@off:0 ease:340ms] ease>
						<span.panel-badge> t('setup.ready.badge')
						<h1> t('setup.ready.title')
						<p> t('setup.ready.subtitle')
						<div.ready-list>
							<div>
								<matreshka-icon name="check-circle">
								<span> t('setup.ready.dns')
							<div>
								<matreshka-icon name="check-circle">
								<span> t('setup.ready.tls')
							<div.address>
								<matreshka-icon name="lock-key">
								<strong> "https://{domain}"
						<button.matreshka-button @click=open_owner>
							<span> t('setup.ready.continue')
							<matreshka-icon name="arrow-right">
						<small.bootstrap>
							<matreshka-icon name="shield-check">
							<span> t('setup.ready.owner')

	css self
		.auth-panel pos:relative w:min(620px, 100%) mih:620px
		.step w:100% mih:620px d:flex fld:column jc:center tween:opacity 240ms ease-out, transform 340ms cubic-bezier(.22,1,.36,1)
		.loading-step ja:center c:var(--matreshka-brand) fs:28px
		.loading-step matreshka-icon animation:spin 1s linear infinite
		.error-step .matreshka-button mt:20px
		.step@enter o:0; transform:translateX(36px)
		.step@leave pos:absolute t:0 l:0 o:0; transform:translateX(-36px)
		.auth-panel.backwards .step@enter transform:translateX(-36px)
		.auth-panel.backwards .step@leave transform:translateX(36px)
		.panel-badge d:block mb:24px c:var(--matreshka-brand) fs:12px fw:750 ls:.08em tt:uppercase
		h1 c:var(--matreshka-navy) fs:36px lh:1.15 ls:-.025em
		.step > p mt:14px c:var(--matreshka-muted) fs:16px lh:1.6
		.sources d:grid gtc:1fr 1fr g:12px mt:28px
		.source pos:relative d:grid gtc:46px 1fr ai:start g:13px mih:178px p:19px 42px 18px 18px bd:1px solid var(--matreshka-line) rd:15px bgc:white cursor:pointer tween:border-color 160ms ease, background-color 160ms ease
		.source@hover border-color:#B8D0F9 bgc:var(--matreshka-soft)
		.source.selected bd:1px solid var(--matreshka-brand) bgc:var(--matreshka-auth-start)
		.source input pos:absolute o:0 pe:none
		.source > matreshka-icon s:44px d:grid ja:center rd:12px bgc:var(--matreshka-soft) c:var(--matreshka-brand) fs:22px
		.source.selected > matreshka-icon bgc:white
		.source strong, .source small d:block
		.source strong c:var(--matreshka-text) fs:15px
		.source small mih:31px mt:5px c:var(--matreshka-brand) fs:11px fw:700 lh:1.4
		.source p mih:50px mt:11px c:var(--matreshka-muted) fs:11px lh:1.5
		.choice-mark pos:absolute r:14px t:14px s:21px d:grid ja:center rd:full bgc:var(--matreshka-brand) c:white fs:12px o:0 transform:scale(.72) tween:opacity 160ms ease, transform 160ms ease
		.source.selected .choice-mark o:1 transform:scale(1)
		.choice-step > .matreshka-button mt:25px
		.free-box mt:18px p:15px rd:13px bgc:var(--matreshka-soft)
		.guide d:flex ai:baseline jc:space-between g:12px
		.guide strong c:var(--matreshka-text) fs:12px
		.guide small c:var(--matreshka-muted) fs:10px
		.catalog d:grid gtc:repeat(3, 1fr) g:8px mt:10px
		.catalog a pos:relative d:block p:10px 28px 9px 10px bd:1px solid var(--matreshka-line) rd:9px bgc:white tween:border-color 160ms ease, transform 160ms ease
		.catalog a@hover border-color:#B8D0F9; transform:translateY(-1px)
		.catalog a > span d:flex ai:center g:5px
		.catalog strong c:var(--matreshka-text) fs:11px
		.catalog small d:block mt:4px c:var(--matreshka-muted) fs:9px
		.catalog em p:2px 4px rd:full bgc:var(--matreshka-auth-start) c:var(--matreshka-brand) fs:7px fw:800 font-style:normal tt:uppercase
		.catalog matreshka-icon pos:absolute r:8px t:11px c:var(--matreshka-brand) fs:12px
		.server-ip d:flex ai:center g:9px mt:11px pt:11px border-top:1px solid var(--matreshka-line) c:var(--matreshka-muted) fs:10px
		.server-ip span fl:1
		.server-ip strong c:var(--matreshka-text) fs:12px
		.server-ip button s:28px d:grid ja:center p:0 bd:0 rd:8px bgc:white c:var(--matreshka-brand)
		.server-ip button@hover bgc:var(--matreshka-auth-start)
		.domain-field mt:18px
		.domain-field input::placeholder c:var(--matreshka-muted) o:.55
		.step > .matreshka-button w:100% mt:22px
		.notice d:flex ai:center g:9px mt:18px c:var(--matreshka-muted) fs:12px lh:1.5
		.notice matreshka-icon c:var(--matreshka-brand) fs:16px
		.progress d:flex ai:center jc:space-between mb:22px c:var(--matreshka-brand) fs:12px fw:750
		.dots d:flex g:6px
		.dots i s:7px rd:full bgc:var(--matreshka-line)
		.dots i.active w:20px bgc:var(--matreshka-brand)
		.back d:flex ai:center g:7px mb:20px p:0 bd:0 bgc:transparent c:var(--matreshka-muted) fs:13px
		.back@hover c:var(--matreshka-brand)
		.record-guide mt:20px
		.record-guide > strong d:block mb:10px c:var(--matreshka-text) fs:12px
		.dns-card bd:1px solid var(--matreshka-line) rd:14px bgc:white of:hidden
		.record pos:relative d:grid gtc:128px 1fr auto ai:center g:14px p:13px 15px border-bottom:1px solid var(--matreshka-line)
		.record@last-child border-bottom:0
		.record small c:var(--matreshka-muted) fs:10px fw:750 ls:.05em tt:uppercase
		.record strong c:var(--matreshka-text) fs:14px
		.record .mono fs:15px
		.copy-value d:flex ai:center g:7px p:8px 10px bd:0 rd:8px bgc:var(--matreshka-soft) c:var(--matreshka-brand) fs:11px fw:700
		.copy-value@hover bgc:var(--matreshka-auth-start)
		.provider mt:12px c:var(--matreshka-muted) fs:11px lh:1.5
		.netlify mt:14px bd:1px solid var(--matreshka-line) rd:12px bgc:white of:hidden
		.netlify-head w:100% d:grid gtc:28px 1fr 18px ai:center g:9px p:12px 14px bd:0 bgc:white cursor:pointer c:var(--matreshka-text) fs:12px fw:650 ta:left
		.netlify-head > matreshka-icon@first-child s:28px d:grid ja:center rd:8px bgc:var(--matreshka-auth-start) c:var(--matreshka-brand) fs:15px
		.netlify .chevron c:var(--matreshka-muted) fs:14px tween:transform 160ms ease
		.netlify.expanded .chevron transform:rotate(180deg)
		.netlify-body d:grid gtr:0fr o:0 tween:grid-template-rows 260ms cubic-bezier(.22,1,.36,1), opacity 180ms ease
		.netlify-body.open gtr:1fr o:1
		.netlify-content min-height:0 of:hidden
		.netlify-content > p p:0 14px c:var(--matreshka-muted) fs:11px lh:1.55
		.netlify-content > a d:flex ai:center g:6px w:max-content m:10px 14px 14px c:var(--matreshka-brand) fs:11px fw:700
		.waiting d:flex ai:center g:9px mt:17px c:var(--matreshka-muted) fs:12px lh:1.45
		.waiting matreshka-icon fl:0 0 auto c:var(--matreshka-warning) fs:16px
		.step > .matreshka-button matreshka-icon.ph-spinner-gap animation:spin 1s linear infinite
		.ready-list d:grid g:11px mt:26px p:17px rd:14px bgc:var(--matreshka-soft)
		.ready-list > div d:flex ai:center g:10px c:var(--matreshka-text) fs:13px
		.ready-list matreshka-icon c:var(--matreshka-success) fs:18px
		.ready-list .address mt:3px pt:13px border-top:1px solid var(--matreshka-line)
		.ready-list .address matreshka-icon c:var(--matreshka-brand)
		.ready-list strong fs:13px
		.bootstrap d:grid gtc:16px auto ai:center jc:center g:8px mt:17px c:var(--matreshka-muted) fs:12px lh:1.45 ta:left
		.bootstrap matreshka-icon c:var(--matreshka-success) fs:15px
		@media(max-width: 560px)
			.auth-panel, .step mih:560px
			h1 fs:30px
			.sources gtc:1fr
			.source mih:auto
			.source small mih:auto
			.source p mih:auto
			.guide small d:none
			.catalog small d:none
			.copy-value span d:none
			.record gtc:104px 1fr auto

tag matreshka-onboarding
	store = null
	step = 0
	direction = 1
	name = 'Федор'
	timezone = Intl.DateTimeFormat!.resolvedOptions!.timeZone or 'Europe/Moscow'
	zones = []
	busy = false
	message = null

	def setup
		const values = Intl['supportedValuesOf'] ? Intl['supportedValuesOf']('timeZone') : [timezone]
		values.unshift timezone unless values.includes(timezone)
		zones = values.map do(value) {value: value, label: fmt.zone(value)}
		zones.sort do(a, b) a.label.localeCompare(b.label, 'ru')

	get valid? do name.trim!.length > 0

	def move next, vector
		direction = vector
		step = next
		message = null

	def advance
		move step + 1, 1

	def back
		move Math.max(0, step - 1), -1

	def create
		busy = true
		message = null
		try
			const bootstrap = new URLSearchParams(window.location.search).get('bootstrap')
			const start = await store.api('POST', '/api/v1/auth/register/options', {name: name, timezone: timezone, bootstrapToken: bootstrap})
			const credential = await window.navigator.credentials.create({publicKey: webauthn.decode(start.options)})
			await store.api('POST', '/api/v1/auth/register/verify', {challengeId: start.challengeId, response: webauthn.json(credential)})
			move 3, 1
		catch issue
			message = issue.message
		finally
			busy = false
			imba.commit!

	def finish
		store.goto('/')
		await store.load!

	<self>
		<matreshka-auth-shell mode="setup">
			<section.auth-panel.setup-panel .backwards=(direction < 0)>
				if step == 0
					<div.step [o@off:0 ease:340ms] ease>
						<span.panel-badge> t('onboarding.badge')
						<h1> t('onboarding.welcome.title')
						<p> t('onboarding.welcome.subtitle')
						<ul.setup-points>
							<li>
								<matreshka-icon name="check">
								<div>
									<strong> t('onboarding.welcome.profile')
									<span> t('onboarding.welcome.profile_hint')
							<li>
								<matreshka-icon name="check">
								<div>
									<strong> t('onboarding.welcome.passkey')
									<span> t('onboarding.welcome.passkey_hint')
							<li>
								<matreshka-icon name="check">
								<div>
									<strong> t('onboarding.welcome.control')
									<span> t('onboarding.welcome.control_hint')
						<button.matreshka-button @click=advance>
							<span> t('onboarding.owner.create')
							<matreshka-icon name="arrow-right">
						<small.bootstrap>
							<matreshka-icon name="timer">
							<span> t('onboarding.bootstrap')
				elif step == 1
					<form.step [o@off:0 ease:340ms] ease @submit.prevent=advance>
						<div.progress>
							<span> t('onboarding.progress.details')
							<div.dots>
								<i.active>
								<i>
						<button.back type="button" @click=back>
							<matreshka-icon name="arrow-left">
							<span> t('onboarding.back')
						<h1> t('onboarding.details.title')
						<p> t('onboarding.details.subtitle')
						<div.fields>
							<label.matreshka-field>
								<span> t('onboarding.name')
								<input bind=name autofocus autocomplete="name">
							<label.matreshka-field>
								<span> t('onboarding.timezone')
								<div.select-field>
									<select bind=timezone>
										for zone in zones
											<option value=zone.value> zone.label
									<span.select-arrow><matreshka-icon name="caret-down">
						<button.matreshka-button type="submit" disabled=!valid?>
							<span> t('onboarding.continue')
							<matreshka-icon name="arrow-right">
				elif step == 2
					<div.step [o@off:0 ease:340ms] ease>
						<div.progress>
							<span> t('onboarding.progress.passkey')
							<div.dots>
								<i.active>
								<i.active>
						<button.back type="button" @click=back>
							<matreshka-icon name="arrow-left">
							<span> t('onboarding.back')
						<h1> t('onboarding.passkey.title')
						<p> t('onboarding.passkey.subtitle')
						<div.passkey-note>
							<matreshka-icon name="device-mobile-camera">
							<div>
								<strong> t('onboarding.passkey.system')
								<span> t('onboarding.passkey.system_hint')
						if message
							<div.matreshka-error> message
						<button.matreshka-button disabled=busy @click=create>
							<matreshka-icon name=(busy ? 'spinner-gap' : 'fingerprint')>
							<span> busy ? t('onboarding.passkey.wait') : t('onboarding.button')
						<small.bootstrap>
							<matreshka-icon name="shield-check">
							<span> t('onboarding.secure')
				else
					<div.step.complete [o@off:0 ease:340ms] ease>
						<div.panel-icon><matreshka-icon name="check">
						<span.panel-badge> t('onboarding.complete.badge')
						<h1> t('onboarding.complete.title').replace('{name}', name)
						<p> t('onboarding.complete.subtitle')
						<div.ready>
							<matreshka-icon name="check-circle">
							<div>
								<strong> t('onboarding.complete.access')
								<span> t('onboarding.complete.access_hint')
						<button.matreshka-button @click=finish>
							<span> t('onboarding.complete.button')
							<matreshka-icon name="arrow-right">

	css self
		.auth-panel pos:relative w:min(520px, 100%) mih:560px
		.step w:100% mih:560px d:flex fld:column jc:center tween:opacity 240ms ease-out, transform 340ms cubic-bezier(.22,1,.36,1)
		.step@enter o:0; transform:translateX(36px)
		.step@leave pos:absolute t:0 l:0 o:0; transform:translateX(-36px)
		.auth-panel.backwards .step@enter transform:translateX(-36px)
		.auth-panel.backwards .step@leave transform:translateX(36px)
		.step > .panel-badge d:block mb:24px c:var(--matreshka-brand) fs:12px fw:750 ls:.08em tt:uppercase
		.panel-icon s:64px d:grid ja:center mb:24px rd:18px bgc:var(--matreshka-auth-start) c:var(--matreshka-brand)
		.panel-icon matreshka-icon fs:31px
		h1 c:var(--matreshka-navy) fs:36px lh:1.15 ls:-.025em
		.step > p mt:14px c:var(--matreshka-muted) fs:16px lh:1.6
		.setup-points d:grid g:17px mt:27px p:0 list-style:none
		.setup-points li d:grid gtc:30px 1fr ai:start g:12px
		.setup-points matreshka-icon s:30px d:grid ja:center rd:full bgc:var(--matreshka-success-soft) c:var(--matreshka-success) fs:16px
		.setup-points strong, .setup-points span d:block
		.setup-points strong c:var(--matreshka-text) fs:14px
		.setup-points span mt:4px c:var(--matreshka-muted) fs:12px lh:1.45
		.step > .matreshka-button w:100% mt:30px
		.bootstrap d:flex ai:center jc:center g:8px mt:17px c:var(--matreshka-muted) fs:12px lh:1.45 ta:center
		.bootstrap matreshka-icon c:var(--matreshka-success) fs:15px
		.progress d:flex ai:center jc:space-between mb:24px c:var(--matreshka-brand) fs:12px fw:750
		.dots d:flex g:6px
		.dots i s:7px rd:full bgc:var(--matreshka-line)
		.dots i.active w:22px bgc:var(--matreshka-brand)
		.back d:flex ai:center g:7px mb:22px p:0 bd:0 bgc:transparent c:var(--matreshka-muted) fs:13px
		.back@hover c:var(--matreshka-brand)
		.fields d:grid g:17px mt:28px
		.select-field pos:relative
		.select-field select appearance:none pr:54px
		.select-arrow pos:absolute r:8px t:50% transform:translateY(-50%) pe:none s:30px d:grid ja:center rd:8px bgc:var(--matreshka-soft) c:var(--matreshka-brand)
		.select-arrow matreshka-icon fs:15px
		.passkey-note, .ready d:grid gtc:38px 1fr ai:start g:13px mt:27px p:16px rd:12px bgc:var(--matreshka-soft)
		.passkey-note > matreshka-icon, .ready > matreshka-icon s:38px d:grid ja:center rd:10px bgc:white c:var(--matreshka-brand) fs:20px
		.passkey-note strong, .passkey-note span, .ready strong, .ready span d:block
		.passkey-note strong, .ready strong c:var(--matreshka-text) fs:14px
		.passkey-note span, .ready span mt:5px c:var(--matreshka-muted) fs:12px lh:1.45
		.step > .matreshka-error mt:20px
		.step > .matreshka-button matreshka-icon.ph-spinner-gap animation:spin 1s linear infinite
		.complete .panel-icon bgc:var(--matreshka-success-soft) c:var(--matreshka-success)
		.complete .ready > matreshka-icon c:var(--matreshka-success)
		@media(max-width: 560px)
			h1 fs:30px

tag matreshka-invite-page
	store = null
	loading = true
	info = null
	result = null
	message = null
	polling = false

	def mount
		load!

	def unmount
		polling = false

	def load
		try
			const redemption = new URLSearchParams(window.location.search).get('redemption')
			if redemption
				result = await store.api('GET', "/api/v1/redemptions/{redemption}")
				watch(redemption) if result.pending
			else
				const token = window.location.pathname.split('/').at(-1)
				info = await store.api('GET', "/api/v1/invitations/{token}")
		catch issue
			message = issue.message
		finally
			loading = false
			imba.commit!

	def redeem
		try
			const token = window.location.pathname.split('/').at(-1)
			result = await store.api('POST', "/api/v1/invitations/{token}/redeem", {})
			if result.redemptionToken
				const query = new URLSearchParams({redemption: result.redemptionToken})
				window.history.replaceState({}, '', "{window.location.pathname}?{query.toString!}")
				watch(result.redemptionToken) if result.pending
		catch issue
			message = issue.message
		imba.commit!

	def watch token
		return if polling
		polling = true
		while polling and result and result.pending
			await new Promise do(resolve) window.setTimeout(resolve, 2000)
			break unless polling
			try
				result = await store.api('GET', "/api/v1/redemptions/{token}")
				message = null
			catch issue
				message = issue.message
				polling = false
			imba.commit!
		polling = false

	<self.auth-screen>
		<div.auth-card.wide>
			<matreshka-logo>
			if loading
				<p> t('loading')
			elif message
				<div.matreshka-error> message
			elif result and result.pending
				<div.auth-icon><matreshka-icon name="spinner-gap">
				<h1> 'Подключаем устройство'
				<p> 'Настройки сохранены. Matreshka повторит синхронизацию с прокси автоматически — эту страницу можно оставить открытой.'
			elif result
				<div.auth-icon><matreshka-icon name="check">
				<h1> 'Подключение готово'
				<p> 'Откройте подписку в выбранном клиенте. Ссылка останется доступна здесь 24 часа.'
				<img.invite-qr src=result.qrDataUrl alt="QR-код подписки">
				<a.matreshka-button href=result.deepLink> 'Открыть в клиенте'
				<details.instructions>
					<summary> 'Если клиент не открылся'
					<ol>
						for step in result.instructions
							<li> step
					<a href=result.subscriptionUrl> 'Открыть URL подписки вручную'
			else
				<div.auth-icon><matreshka-icon name="device-mobile">
				<h1> "{info.person_name}, подключаем {info.device_name}"
				<p> "Профиль для {info.client == 'incy' ? 'INCY' : 'Everywhere'} добавит два защищённых соединения и маршруты."
				<button.matreshka-button @click=redeem> 'Подключить это устройство'

global css
	.auth-screen
		min-height: 100vh
		display: grid
		place-items: center
		padding: 28px
		background: var(--matreshka-soft)
	.auth-card
		width: min(430px, 100%)
		padding: 40px
		border: 1px solid var(--matreshka-line)
		border-radius: 18px
		background: #fff
		box-shadow: 0 20px 60px #0C1E4110
		&.wide width: min(520px, 100%)
		matreshka-logo margin-bottom: 44px
		.auth-icon width: 64px; height: 64px; display: grid; place-items: center; margin-bottom: 22px; border-radius: 50%; background: #EAF1FC; color: #0B56D9
		.auth-icon matreshka-icon font-size: 32px
		h1 color: #071127; font-size: 30px; line-height: 1.2
		> p margin-top: 12px; color: #69748D; font-size: 16px; line-height: 1.5
		> .matreshka-button width: 100%; margin-top: 28px
		> .matreshka-error margin-top: 20px
		.secure display: flex; gap: 8px; margin-top: 20px; color: #7C879C; line-height: 1.45
		.invite-qr display: block; width: 220px; height: 220px; margin: 24px auto 0
		.instructions margin-top: 20px; color: #69748D; line-height: 1.55
		.instructions summary cursor: pointer; color: #365078; font-weight: 650
		.instructions a display: inline-block; margin-top: 8px; color: #0B56D9
