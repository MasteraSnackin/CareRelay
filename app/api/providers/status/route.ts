import {
  handleApiRoute,
  jsonResponse,
} from "@/lib/api-response";
import { getProviderStatuses } from "@/lib/provider-status";

export async function GET(request: Request): Promise<Response> {
  return handleApiRoute(request, async (requestId) =>
    jsonResponse(requestId, { providers: getProviderStatuses() }),
  );
}
