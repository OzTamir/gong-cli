# Gong API operation inventory

Generated from reference/gong-openapi.json (fetched 2026-07-05 from https://gong.app.gong.io/ajax/settings/api/documentation/specs). 67 operations.

| Tag | Method | Path | operationId |
|---|---|---|---|
| Auditing | GET | /v2/logs | listLogs |
| Calls | GET | /v2/calls | listCalls |
| Calls | POST | /v2/calls | addCall |
| Calls | GET | /v2/calls/{id} | getCall |
| Calls | PUT | /v2/calls/{id}/media | addCallRecording |
| Calls | POST | /v2/calls/extensive | listCallsExtensive |
| Calls | POST | /v2/calls/transcript | getCallTranscripts |
| Coaching | GET | /v2/coaching | listUsers_1 |
| CRM | GET | /v2/crm/entities | getCrmObjects |
| CRM | POST | /v2/crm/entities | uploadCrmData |
| CRM | GET | /v2/crm/entity-schema | listCrmSchemaFields |
| CRM | POST | /v2/crm/entity-schema | uploadCrmSchemaField |
| CRM | DELETE | /v2/crm/integrations | deleteGenericCrmIntegration |
| CRM | GET | /v2/crm/integrations | listGenericCrmIntegration |
| CRM | PUT | /v2/crm/integrations | registerGenericCrmIntegration |
| CRM | GET | /v2/crm/request-status | getRequestStatus |
| Data Privacy | GET | /v2/data-privacy/data-for-email-address | findAllReferencesToEmailAddress |
| Data Privacy | GET | /v2/data-privacy/data-for-phone-number | findAllReferencesToPhoneNumber |
| Data Privacy | POST | /v2/data-privacy/erase-data-for-email-address | purgeEmailAddress |
| Data Privacy | POST | /v2/data-privacy/erase-data-for-phone-number | purgePhoneNumber |
| Digital Interactions | POST | /v2/digital-interaction | addDigitalInteraction |
| Engage Flows | GET | /v2/flows | listFlows |
| Engage Flows | GET | /v2/flows/folders | listFlowsFolders |
| Engage Flows | POST | /v2/flows/prospects | getProspectsAssignedFlows |
| Engage Flows | POST | /v2/flows/prospects/assign | assignProspects |
| Engage Flows | POST | /v2/flows/prospects/assign/cool-off-override | assignProspectsCoolOffOverrides |
| Engage Flows | POST | /v2/flows/prospects/bulk-assignments | submitFlowProspectsBulkAssignment |
| Engage Flows | GET | /v2/flows/prospects/bulk-assignments/{id} | getFlowProspectsBulkAssignment |
| Engage Flows | POST | /v2/flows/prospects/unassign-flows-by-crm-id | unassignProspectFlows |
| Engage Flows | POST | /v2/flows/prospects/unassign-flows-by-instance-id | unassignFlows |
| Engage Flows | POST | /v2/flows/steps | getFlowSteps |
| Engagement (Legacy – See “Digital Interactions”) | PUT | /v2/customer-engagement/action | customAction |
| Engagement (Legacy – See “Digital Interactions”) | PUT | /v2/customer-engagement/content/shared | contentShared |
| Engagement (Legacy – See “Digital Interactions”) | PUT | /v2/customer-engagement/content/viewed | contentViewed |
| Entities | GET | /v2/entities/ask-entity | askEntity |
| Entities | GET | /v2/entities/get-brief | generateBrief |
| Integration Settings | POST | /v2/integration-settings | integrationSettings |
| Library | GET | /v2/library/folder-content | getCallsInSpecificFolder |
| Library | GET | /v2/library/folders | getLibraryStructure |
| Meetings (in Beta Phase) | POST | /v2/meetings | addMeeting |
| Meetings (in Beta Phase) | DELETE | /v2/meetings/{meetingId} | deleteMeeting |
| Meetings (in Beta Phase) | PUT | /v2/meetings/{meetingId} | updateMeeting |
| Meetings (in Beta Phase) | POST | /v2/meetings/integration/status | integrationStatus |
| Outcomes | GET | /v2/call-outcomes | listCallOutcomes |
| Permissions | GET | /v2/all-permission-profiles | listPermissionProfile |
| Permissions | DELETE | /v2/calls/users-access | deleteUsersAccessToCalls |
| Permissions | POST | /v2/calls/users-access | getUsersAccessToCalls |
| Permissions | PUT | /v2/calls/users-access | addUsersAccessToCalls |
| Permissions | GET | /v2/permission-profile | getPermissionProfile |
| Permissions | POST | /v2/permission-profile | createPermissionProfile |
| Permissions | PUT | /v2/permission-profile | updatePermissionProfile |
| Permissions | GET | /v2/permission-profile/users | listPermissionProfileUsers |
| Settings | GET | /v2/settings/briefs | listBriefs |
| Settings | GET | /v2/settings/scorecards | listScorecards |
| Settings | GET | /v2/settings/trackers | listTrackers |
| Settings | GET | /v2/workspaces | listWorkspaces |
| Stats | POST | /v2/stats/activity/aggregate | listMultipleUsersAggregateActivity |
| Stats | POST | /v2/stats/activity/aggregate-by-period | listMultipleUsersAggregateByPeriod |
| Stats | POST | /v2/stats/activity/day-by-day | listMultipleUsersDayByDayActivity |
| Stats | POST | /v2/stats/activity/scorecards | listAnsweredScorecards |
| Stats | POST | /v2/stats/interaction | listInteractionStats |
| Tasks | POST | /v2/tasks | listTasks |
| Tasks | PATCH | /v2/tasks/{taskId} | updateReminder |
| Users | GET | /v2/users | listUsers |
| Users | GET | /v2/users/{id} | getUser |
| Users | GET | /v2/users/{id}/settings-history | getUserHistory |
| Users | POST | /v2/users/extensive | listMultipleUsers |
