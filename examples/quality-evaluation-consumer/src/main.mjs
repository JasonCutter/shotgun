import { ratio } from '@shotgun/quality-evaluation';

const result = ratio(1, 1);

if (result.value !== 1) {
  throw new Error(`Unexpected standalone metric result: ${JSON.stringify(result)}`);
}

console.log(
  JSON.stringify({
    package: '@shotgun/quality-evaluation',
    exactRatio: result.value,
    shotgunApplicationInstalled: false,
  }),
);
