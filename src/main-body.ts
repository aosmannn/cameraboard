import { p0 } from './main-body-p0';
import { p1 } from './main-body-p1';
import { p2 } from './main-body-p2';
import { p3 } from './main-body-p3';
export function run(deps) {
  new Function('deps', p0 + p1 + p2 + p3)(deps);
}
