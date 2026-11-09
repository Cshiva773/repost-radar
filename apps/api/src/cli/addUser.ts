import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../auth/credentials.js';
import { createCreatorAccount } from '../auth/signupRepository.js';
import { displayNameFromEmail, parseSignupBody } from '../auth/signupRules.js';

// Gives someone their own private space while public sign-up is off (SIGNUP_ENABLED=false).
//   docker compose exec api node dist/cli/addUser.js friend@example.com "Friend's name"
// The password is ADD_USER_PASSWORD when set, otherwise a random one printed once for the operator to pass on.
const GENERATED_PASSWORD_BYTES = 18;
const USAGE_TEXT = 'Usage: node dist/cli/addUser.js <email> ["display name"]';

interface AddUserInputDetails {
  email: string;
  displayName: string;
  password: string;
  isPasswordGenerated: boolean;
}

function readAddUserInput(argumentList: string[], environmentDetails: NodeJS.ProcessEnv): AddUserInputDetails | undefined {
  const [email, displayName] = argumentList;
  if (!email) return undefined;
  const providedPassword = environmentDetails.ADD_USER_PASSWORD;
  return {
    email,
    displayName: displayName ?? displayNameFromEmail(email),
    password: providedPassword || randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url'),
    isPasswordGenerated: !providedPassword,
  };
}

async function addUser(addUserInput: AddUserInputDetails): Promise<number> {
  const parseResult = parseSignupBody({ displayName: addUserInput.displayName, email: addUserInput.email, password: addUserInput.password });
  if (parseResult.isError) {
    console.error(`Step 1: ${parseResult.message}`);
    return 1;
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const accountResult = await createCreatorAccount(pool, parseResult.signupInput, await hashPassword(addUserInput.password));
    if (accountResult.isError) {
      console.error(accountResult.errorKind === 'duplicate' ? 'Step 2: an account with this email already exists' : 'Step 2: could not create the account');
      return 1;
    }
    console.log(`Step 2: created ${accountResult.reviewer.username} (creator ${accountResult.reviewer.creatorId}) with their own private space`);
    if (addUserInput.isPasswordGenerated) console.log(`Step 3: their password, shown once: ${addUserInput.password}`);
    return 0;
  } finally {
    await pool.end();
  }
}

const addUserInput = readAddUserInput(process.argv.slice(2), process.env);
if (!addUserInput) {
  console.error(USAGE_TEXT);
  process.exit(1);
}
addUser(addUserInput).then((exitCode) => process.exit(exitCode)).catch((error) => {
  console.error('addUser failed', error);
  process.exit(1);
});
