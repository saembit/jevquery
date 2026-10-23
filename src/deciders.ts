import type { Decider } from './types';

/**
 * typesafeDecider
 * A decider that calls the TypeSafe api directly, server side only, never ship the key to a browser
 * @param apiKey {string} - the api key
 * @param model {string} - the model alias or id
 * @param baseUrl {string} - the api root
 * @param fetchImpl {typeof fetch} - a fetch to use instead of the global one
 * @return {Decider}
 **/
export function typesafeDecider(apiKey: string, model = 'jev-latest', baseUrl = 'https://api.typesafe.ai', fetchImpl: typeof fetch = fetch): Decider {
	// The key only ever goes over https, or to this machine
	if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) throw new Error('baseUrl must be https, or http on localhost');
	return async (state, questions) => {
		const res = await fetchImpl(`${baseUrl}/v1/systemone`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model, state, questions }),
		});
		if (!res.ok) throw new Error(`typesafe failed: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const body = (await res.json()) as { answers?: unknown };
		if (!body || typeof body.answers !== 'object' || body.answers === null || Array.isArray(body.answers)) throw new Error('typesafe response has no answers object');
		return body.answers as Awaited<ReturnType<Decider>>;
	};
}
