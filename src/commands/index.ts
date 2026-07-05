/**
 * Command-group registry. Each group file owns its `gong <group>` subtree end to end;
 * groups never import each other. Registration order = help listing order.
 */
import type { GroupRegistrar } from '../program.js';

import { registerCalls } from './calls.js';
import { registerUsers } from './users.js';
import { registerCoaching } from './coaching.js';
import { registerStats } from './stats.js';
import { registerCrm } from './crm.js';
import { registerFlows } from './flows.js';
import { registerPermissions } from './permissions.js';
import { registerLibrary } from './library.js';
import { registerSettings } from './settings.js';
import { registerWorkspaces } from './workspaces.js';
import { registerOutcomes } from './outcomes.js';
import { registerPrivacy } from './privacy.js';
import { registerLogs } from './logs.js';
import { registerMeetings } from './meetings.js';
import { registerTasks } from './tasks.js';
import { registerEntities } from './entities.js';
import { registerInteractions } from './interactions.js';
import { registerEngagement } from './engagement.js';
import { registerIntegrationSettings } from './integration-settings.js';
import { registerAuth } from './auth.js';
import { registerConfig } from './config-cmd.js';

export const registrars: GroupRegistrar[] = [
  registerCalls,
  registerUsers,
  registerCoaching,
  registerStats,
  registerCrm,
  registerFlows,
  registerPermissions,
  registerLibrary,
  registerSettings,
  registerWorkspaces,
  registerOutcomes,
  registerPrivacy,
  registerLogs,
  registerMeetings,
  registerTasks,
  registerEntities,
  registerInteractions,
  registerEngagement,
  registerIntegrationSettings,
  registerAuth,
  registerConfig,
];
