import * as horizon from './horizon.mjs';
import * as aquarius from './aquarius.mjs';
import * as broker from './broker.mjs';
import * as soroswap from './soroswap.mjs';

/** The four exit venues of the brief; `best exit` is taken across these. */
export const TOP_VENUES = ['sdex_horizon', 'soroswap_agg', 'aquarius', 'broker'];
export { horizon, aquarius, broker, soroswap };
