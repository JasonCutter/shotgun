import {
  buildCommandSemanticDigestInput,
  type FrontendCommandRequest,
  type SemanticDigestProvider,
} from '../../contracts/src/frontend-entry.js';

export const webCryptoDigestProvider: SemanticDigestProvider = async (
  canonicalJson: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalJson);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function computeCommandSemanticDigestAsync<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  provider: SemanticDigestProvider = webCryptoDigestProvider,
): Promise<string> {
  const input = buildCommandSemanticDigestInput(request);
  return provider(input);
}
