import {
  decodeDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from './discovery-finding.js';

/**
 * The wire boundary deliberately has no second Discovery model. The WP1
 * decoder remains the authority for both values entering and leaving JSON.
 */
export const serializeDiscoveryFindingEnvelopeV1 = (value: unknown): string =>
  JSON.stringify(decodeDiscoveryFindingEnvelopeV1(value, 'discoveryFinding'));

export const deserializeDiscoveryFindingEnvelopeV1 = (
  serialized: string,
): DiscoveryFindingEnvelopeV1 => {
  if (typeof serialized !== 'string') {
    throw new TypeError('discoveryFinding: serialized value must be a string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError('discoveryFinding: serialized value must be valid JSON', { cause: error });
  }
  return decodeDiscoveryFindingEnvelopeV1(parsed, 'discoveryFinding');
};
