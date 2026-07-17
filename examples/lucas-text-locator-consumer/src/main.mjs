import { locateTextQuote } from '@shotgun/lucas-text-locator';

const result = locateTextQuote('alpha\n  beta and gamma', {
  exact: 'alpha beta',
});
if (result?.start !== 0 || result.end !== 12) {
  throw new Error(`Unexpected locator result: ${JSON.stringify(result)}`);
}

console.log(
  JSON.stringify({
    package: '@shotgun/lucas-text-locator',
    result,
    shotgunApplicationInstalled: false,
  }),
);
