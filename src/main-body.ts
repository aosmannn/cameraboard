import { p1 } from './main-body-p1';
import { p2 } from './main-body-p2';
export function run(deps) {
  new Function('deps', p1 + p2)(deps);
}
