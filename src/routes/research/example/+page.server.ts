import { sampleReport } from "$lib/server/sample-report";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({ sample: sampleReport() });
