#!/usr/bin/env bash
# Runs the API side of test areas M, N, O, P and Q (test sheet, 10 Nov) against a running local stack that
# already holds the operator's data (scripts/codespace-up.sh with sign-up on). Never stops at a failure: every
# case ends in one line "RESULT <id> <PASS|FAIL> <what was seen>", also written to journey-results.tsv.
#   bash scripts/journey-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
BASE_URL="${BASE_URL:-http://localhost:3000/api}"
# The API port without nginx in front: requests there can name their own visitor address (local stack only)
DIRECT_API_URL="${DIRECT_API_URL:-http://localhost:8080}"
RESULTS_FILE="${RESULTS_FILE:-journey-results.tsv}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
: > "$RESULTS_FILE"
PRIYA_EMAIL="priya@example.com"
PRIYA_PASSWORD="priya-password-1234"
OPERATOR_TEMPLATE_MARK="OLD-TEMPLATE-OPERATOR"
PRIYA_TEMPLATE_MARK="PRIYA-TEMPLATE"
FIXTURE_SUBREDDIT="repostradar_fixture"

record() {
  local caseId="$1" verdict="$2" observedText="$3"
  echo "RESULT $caseId $verdict $observedText"
  printf '%s\t%s\t%s\n' "$caseId" "$verdict" "$observedText" >> "$RESULTS_FILE"
}

# call <jar> <METHOD> <path> [json body]: body to $WORK_DIR/last.json, status in HTTP_STATUS
call() {
  local cookieJar="$1" httpMethod="$2" requestPath="$3" requestBody="${4:-}"
  local bodyArgs=()
  [ -n "$requestBody" ] && bodyArgs=(-H 'content-type: application/json' -d "$requestBody")
  HTTP_STATUS="$(curl -s -o "$WORK_DIR/last.json" -w '%{http_code}' -b "$cookieJar" -c "$cookieJar" -X "$httpMethod" "${bodyArgs[@]}" "$BASE_URL$requestPath")"
}

last() { jq -r "$1" "$WORK_DIR/last.json" 2> /dev/null; }

credentials_json() { jq -nc --arg username "$1" --arg password "$2" '{username: $username, password: $password}'; }

sign_in() { call "$1" POST /auth/login "$(credentials_json "$2" "$3")"; }

sign_up() { call "$1" POST /auth/signup "$(jq -nc --arg email "$2" --arg password "$3" --arg displayName "${4:-}" '{email: $email, password: $password, displayName: $displayName}')"; }

sql() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" 2> /dev/null | tr -d '[:space:]'; }

flush_redis() { docker compose exec -T redis sh -c "redis-cli --scan --pattern '$1' | xargs -r redis-cli del" > /dev/null; }

add_user() { docker compose exec -T -e ADD_USER_PASSWORD="${ADD_USER_PASSWORD:-}" api node dist/cli/addUser.js "$@" 2>&1; }

upload_file() {
  HTTP_STATUS="$(curl -s -o "$WORK_DIR/last.json" -w '%{http_code}' -b "$1" -c "$1" -F "file=@$2" "$BASE_URL/assets")"
}

wait_for() {
  local attemptLimit="$1"; shift
  local attemptNumber
  for ((attemptNumber = 1; attemptNumber <= attemptLimit; attemptNumber++)); do "$@" && return 0; sleep 5; done
  return 1
}

# ---------- Starting state: the operator's existing data ----------
OPERATOR_JAR="$WORK_DIR/operator.jar"
sign_in "$OPERATOR_JAR" "${ADMIN_USERNAME:-admin}" "$ADMIN_PASSWORD"
[ "$HTTP_STATUS" = 200 ] && record P2 PASS "operator signs in with the plain username ${ADMIN_USERNAME:-admin} (HTTP 200)" \
  || record P2 FAIL "operator sign-in with ${ADMIN_USERNAME:-admin} answered HTTP $HTTP_STATUS"
call "$OPERATOR_JAR" PUT /creator '{"name":"Olivia Operator","legalName":"Olivia Operator","contactEmail":"olivia@example.com","mailingAddress":"1 Operator Road"}'
call "$OPERATOR_JAR" GET /notice-templates
OPERATOR_REDDIT_TEMPLATE="$(last '[.noticeTemplateList[] | select(.platform=="reddit")][0]')"
OPERATOR_TEMPLATE_ID="$(jq -r .templateId <<< "$OPERATOR_REDDIT_TEMPLATE")"
call "$OPERATOR_JAR" PUT "/notice-templates/$OPERATOR_TEMPLATE_ID" "$(jq -c --arg mark "$OPERATOR_TEMPLATE_MARK" '{platform, name, subject, body: (.body + "\n" + $mark)}' <<< "$OPERATOR_REDDIT_TEMPLATE")"
wait_for 36 bash -c "curl -s -b '$OPERATOR_JAR' '$BASE_URL/candidates?status=pending' | jq -e '.totalCount >= 3' > /dev/null"
call "$OPERATOR_JAR" GET "/candidates?status=pending&pageSize=50"
OPERATOR_PENDING_BEFORE="$(last .totalCount)"
OPERATOR_CANDIDATE_ID="$(last '.candidateList[0].candidateId')"
OPERATOR_ASSET_ID="$(last '.candidateList[0].assetId')"
call "$OPERATOR_JAR" POST /watch-targets '{"platform":"reddit","target":"repostradar_throwaway","pollIntervalSeconds":3600}'
OPERATOR_THROWAWAY_SOURCE_ID="$(last .watchTargetId)"
call "$OPERATOR_JAR" GET /watch-targets
OPERATOR_FIXTURE_SOURCE_ID="$(last "[.watchTargetList[] | select(.targetName==\"$FIXTURE_SUBREDDIT\")][0].watchTargetId")"
echo "Starting state: operator has $OPERATOR_PENDING_BEFORE pending, candidate $OPERATOR_CANDIDATE_ID, asset $OPERATOR_ASSET_ID, template $OPERATOR_TEMPLATE_ID, sources $OPERATOR_FIXTURE_SOURCE_ID/$OPERATOR_THROWAWAY_SOURCE_ID"
flush_redis 'signups:*'

# ---------- M. Sign-up ----------
PRIYA_JAR="$WORK_DIR/priya.jar"
sign_up "$PRIYA_JAR" "$PRIYA_EMAIL" "$PRIYA_PASSWORD" "Priya"
signupStatus="$HTTP_STATUS"
call "$PRIYA_JAR" GET /creator; creatorJson="$(cat "$WORK_DIR/last.json")"
call "$PRIYA_JAR" GET '/assets?pageSize=1'; assetTotal="$(last .totalCount)"
call "$PRIYA_JAR" GET /watch-targets; sourceTotal="$(last .watchTargetCount)"
call "$PRIYA_JAR" GET /notice-templates; templateCount="$(last .noticeTemplateCount)"; templatePlatforms="$(last '[.noticeTemplateList[].platform] | sort | join(",")')"
if [ "$signupStatus" = 201 ] && [ "$(jq -r .name <<< "$creatorJson")" = Priya ] && [ "$(jq -r .contactEmail <<< "$creatorJson")" = "$PRIYA_EMAIL" ] \
  && [ "$(jq -r .isNoticeReady <<< "$creatorJson")" = false ] && [ "$assetTotal" = 0 ] && [ "$sourceTotal" = 0 ] && [ "$templatePlatforms" = "bluesky,reddit" ]; then
  record M1 PASS "201; name Priya, contact email prefilled, details not ready (0 of 3), 0 originals, 0 sources, templates: $templatePlatforms"
else
  record M1 FAIL "signup $signupStatus; creator $(jq -c '{name,contactEmail,isNoticeReady}' <<< "$creatorJson"); originals $assetTotal; sources $sourceTotal; templates $templateCount ($templatePlatforms)"
fi

sign_up "$WORK_DIR/m2.jar" "  Priya.K@Example.COM " "m2-password-123456"
storedName="$(last .username)"; signupStatus="$HTTP_STATUS"
sign_in "$WORK_DIR/m2a.jar" "priya.k@example.com" "m2-password-123456"; lowerStatus="$HTTP_STATUS"
sign_in "$WORK_DIR/m2b.jar" "PRIYA.K@EXAMPLE.COM" "m2-password-123456"; upperStatus="$HTTP_STATUS"
[ "$signupStatus" = 201 ] && [ "$storedName" = "priya.k@example.com" ] && [ "$lowerStatus" = 200 ] && [ "$upperStatus" = 200 ] \
  && record M2 PASS "stored as $storedName; lower-case and upper-case sign-ins both 200" \
  || record M2 FAIL "signup $signupStatus stored '$storedName'; lower $lowerStatus; upper $upperStatus"

sign_up "$WORK_DIR/m3.jar" "Priya@Example.com" "another-password-123" "Imposter"
dupStatus="$HTTP_STATUS"; dupMessage="$(last .message)"
creatorRows="$(sql "SELECT count(*) FROM creators WHERE lower(contact_email) = '$PRIYA_EMAIL'")"
sign_in "$WORK_DIR/m3b.jar" "$PRIYA_EMAIL" "$PRIYA_PASSWORD"; oldPasswordStatus="$HTTP_STATUS"
[ "$dupStatus" = 409 ] && [ "$creatorRows" = 1 ] && [ "$oldPasswordStatus" = 200 ] \
  && record M3 PASS "409 \"$dupMessage\"; still 1 creator; old password works" \
  || record M3 FAIL "status $dupStatus \"$dupMessage\"; creators with that email $creatorRows; old password $oldPasswordStatus"

sign_up "$WORK_DIR/m4.jar" "short@example.com" "elevenchars" ""
shortStatus="$HTTP_STATUS"; shortMessage="$(last .message)"
shortRows="$(sql "SELECT count(*) FROM users WHERE username = 'short@example.com'")"
[ "$shortStatus" = 400 ] && [ "$shortRows" = 0 ] && record M4 PASS "400 \"$shortMessage\"; no account" \
  || record M4 FAIL "status $shortStatus \"$shortMessage\"; accounts $shortRows"

m5Body="$(jq -nc '{email: "twice@example.com", password: "twice-password-1234"}')"
for attemptNumber in 1 2; do
  curl -s -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -d "$m5Body" "$BASE_URL/auth/signup" >> "$WORK_DIR/m5.txt" &
done
wait
m5Statuses="$(sort "$WORK_DIR/m5.txt" | tr '\n' ' ')"
m5Users="$(sql "SELECT count(*) FROM users WHERE username = 'twice@example.com'")"
orphanCreators="$(sql "SELECT count(*) FROM creators c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.creator_id = c.id)")"
[ "$m5Statuses" = "201 409 " ] && [ "$m5Users" = 1 ] && [ "$orphanCreators" = 0 ] && record M5 PASS "statuses $m5Statuses; 1 account; no creator without a user" \
  || record M5 FAIL "statuses $m5Statuses; accounts $m5Users; creators without a user $orphanCreators"

call "$PRIYA_JAR" GET /auth/me; meStatus="$HTTP_STATUS"
sign_in "$WORK_DIR/m9.jar" "$PRIYA_EMAIL" "$PRIYA_PASSWORD"
[ "$meStatus" = 200 ] && [ "$HTTP_STATUS" = 200 ] && record M9 PASS "session still valid; fresh sign-in 200 (API side; reload checked in the browser run)" \
  || record M9 FAIL "session $meStatus; sign-in $HTTP_STATUS"

# ---------- N. Private spaces ----------
call "$PRIYA_JAR" GET '/candidates?status=pending'; nPending="$(last .totalCount)"
call "$PRIYA_JAR" GET '/candidates?status=approved'; nApproved="$(last .totalCount)"
call "$PRIYA_JAR" GET '/candidates?status=dismissed'; nDismissed="$(last .totalCount)"
call "$PRIYA_JAR" GET /watch-target-suggestions; nSuggestions="$(last '.suggestionList // [] | length')"
call "$PRIYA_JAR" GET /notice-templates; nOperatorMark="$(last "[.noticeTemplateList[].body | select(contains(\"$OPERATOR_TEMPLATE_MARK\"))] | length")"
[ "$nPending$nApproved$nDismissed" = 000 ] && [ "$nSuggestions" = 0 ] && [ "$nOperatorMark" = 0 ] \
  && record N1 PASS "0 pending/approved/dismissed, 0 suggestions, no operator template edits in Priya's templates" \
  || record N1 FAIL "pending $nPending approved $nApproved dismissed $nDismissed suggestions $nSuggestions operator-edited templates $nOperatorMark"

n2Report=""
probe() { call "$PRIYA_JAR" "$1" "$2" "${3:-}"; n2Report+="$1 $2 → $HTTP_STATUS; "; [ "$HTTP_STATUS" = 404 ]; }
n2Failures=0
probe GET "/candidates/$OPERATOR_CANDIDATE_ID" || n2Failures=$((n2Failures + 1))
probe GET "/candidates/$OPERATOR_CANDIDATE_ID/images/original" || n2Failures=$((n2Failures + 1))
probe GET "/candidates/$OPERATOR_CANDIDATE_ID/notice" || n2Failures=$((n2Failures + 1))
probe GET "/assets/$OPERATOR_ASSET_ID" || n2Failures=$((n2Failures + 1))
probe GET "/assets/$OPERATOR_ASSET_ID/image" || n2Failures=$((n2Failures + 1))
probe GET "/notice-templates/$OPERATOR_TEMPLATE_ID" || n2Failures=$((n2Failures + 1))
probe PUT "/notice-templates/$OPERATOR_TEMPLATE_ID" '{"platform":"reddit","name":"x","subject":"x","body":"HIJACKED"}' || n2Failures=$((n2Failures + 1))
probe POST "/candidates/$OPERATOR_CANDIDATE_ID/decision" '{"action":"dismiss","note":"not yours"}' || n2Failures=$((n2Failures + 1))
probe PATCH "/watch-targets/$OPERATOR_THROWAWAY_SOURCE_ID" '{"enabled":false}' || n2Failures=$((n2Failures + 1))
probe DELETE "/watch-targets/$OPERATOR_THROWAWAY_SOURCE_ID" || n2Failures=$((n2Failures + 1))
call "$OPERATOR_JAR" GET /watch-targets
throwawayState="$(last "[.watchTargetList[] | select(.watchTargetId==$OPERATOR_THROWAWAY_SOURCE_ID)][0] | if . == null then \"gone\" else (if .enabled then \"enabled\" else \"paused\" end) end")"
call "$OPERATOR_JAR" GET "/candidates/$OPERATOR_CANDIDATE_ID"; operatorCandidateStatus="$(last .status)"
call "$OPERATOR_JAR" GET "/notice-templates/$OPERATOR_TEMPLATE_ID"; templateHijacked="$(last '.body | contains("HIJACKED")')"
[ "$n2Failures" = 0 ] && [ "$throwawayState" = enabled ] && [ "$operatorCandidateStatus" = pending ] && [ "$templateHijacked" = false ] \
  && record N2 PASS "all 10 reads/changes 404; operator's source enabled, candidate pending, template intact" \
  || record N2 FAIL "${n2Report}operator's source now: $throwawayState; candidate: $operatorCandidateStatus; template changed: $templateHijacked"

curl -s -b "$OPERATOR_JAR" -o "$WORK_DIR/operator-original.jpg" "$BASE_URL/assets/$OPERATOR_ASSET_ID/image"
upload_file "$PRIYA_JAR" "$WORK_DIR/operator-original.jpg"; firstUpload="$HTTP_STATUS"; PRIYA_ASSET_ID="$(last .assetId)"
upload_file "$PRIYA_JAR" "$WORK_DIR/operator-original.jpg"; secondUpload="$HTTP_STATUS"
[ "$firstUpload" = 202 ] && [ "$secondUpload" = 409 ] && [ "$PRIYA_ASSET_ID" != "$OPERATOR_ASSET_ID" ] \
  && record N3 PASS "accepted as Priya's own original #$PRIYA_ASSET_ID (operator's is #$OPERATOR_ASSET_ID); second upload 409 already registered" \
  || record N3 FAIL "first upload $firstUpload (asset $PRIYA_ASSET_ID), second $secondUpload"

call "$PRIYA_JAR" POST /watch-targets "{\"platform\":\"reddit\",\"target\":\"$FIXTURE_SUBREDDIT\",\"pollIntervalSeconds\":300}"
PRIYA_SOURCE_ID="$(last .watchTargetId)"
priya_has_match() { curl -s -b "$PRIYA_JAR" "$BASE_URL/candidates?status=pending" | jq -e '.totalCount >= 1' > /dev/null; }
wait_for 48 priya_has_match
call "$PRIYA_JAR" GET '/candidates?status=pending&pageSize=50'
priyaPending="$(last .totalCount)"; priyaForeignAssets="$(last "[.candidateList[] | select(.assetId != $PRIYA_ASSET_ID)] | length")"
PRIYA_CANDIDATE_ID="$(last '.candidateList[0].candidateId')"
call "$OPERATOR_JAR" GET '/candidates?status=pending'; operatorPendingAfter="$(last .totalCount)"
call "$PRIYA_JAR" PATCH "/watch-targets/$PRIYA_SOURCE_ID" '{"enabled":false}'
call "$OPERATOR_JAR" GET /watch-targets; operatorFixtureEnabled="$(last "[.watchTargetList[] | select(.watchTargetId==$OPERATOR_FIXTURE_SOURCE_ID)][0].enabled")"
call "$PRIYA_JAR" PATCH "/watch-targets/$PRIYA_SOURCE_ID" '{"enabled":true}'
[ "${priyaPending:-0}" -ge 1 ] && [ "$priyaForeignAssets" = 0 ] && [ "$operatorPendingAfter" = "$OPERATOR_PENDING_BEFORE" ] && [ "$operatorFixtureEnabled" = true ] \
  && record N4 PASS "Priya got $priyaPending match(es), all on her own original; operator still $operatorPendingAfter pending; pausing Priya's source left the operator's enabled" \
  || record N4 FAIL "Priya pending ${priyaPending:-none} (foreign-asset matches $priyaForeignAssets); operator pending $OPERATOR_PENDING_BEFORE → $operatorPendingAfter; operator source enabled $operatorFixtureEnabled"

# ---------- O. Server side of the setup rules ----------
call "$PRIYA_JAR" PUT /creator '{"name":"Priya","legalName":"Priya Kapoor","contactEmail":"priya@example.com","mailingAddress":""}'
clearedReady="$(last .isNoticeReady)"
if [ -n "${PRIYA_CANDIDATE_ID:-}" ] && [ "$PRIYA_CANDIDATE_ID" != null ]; then
  call "$PRIYA_JAR" POST "/candidates/$PRIYA_CANDIDATE_ID/decision" '{"action":"approve","goodFaith":true}'
  o4Approve="$HTTP_STATUS $(last .message)"
else
  o4Approve="no pending match to try"
fi
[ "$clearedReady" = false ] && [[ "$o4Approve" == 4* ]] && record O4 PASS "API side: address cleared → not notice-ready; approve refused ($o4Approve). Note and checklist checked in the browser run" \
  || record O4 FAIL "API side: ready after clearing: $clearedReady; approve: $o4Approve"
call "$PRIYA_JAR" PUT /creator '{"name":"Priya","legalName":"   ","contactEmail":"priya@example.com","mailingAddress":"7 Creator Lane"}'
spacesStatus="$HTTP_STATUS"; spacesReady="$(last .isNoticeReady)"; spacesLegal="$(last '.legalName | tostring')"
[ "$spacesReady" = false ] && record O5 PASS "API side: legal name of spaces saved as $spacesLegal, not notice-ready (status $spacesStatus)" \
  || record O5 FAIL "API side: spaces-only legal name gave isNoticeReady=$spacesReady ($spacesLegal, status $spacesStatus)"
call "$PRIYA_JAR" PUT /creator '{"name":"Priya","legalName":"Priya Kapoor","contactEmail":"priya@example.com","mailingAddress":"7 Creator Lane"}'

call "$PRIYA_JAR" PUT /creator '{"name":"Priya","legalName":"Priya Kapoor","contactEmail":"priya@example.com","mailingAddress":"7 Creator Lane"}'
call "$PRIYA_JAR" GET /notice-templates
priyaRedditTemplate="$(last '[.noticeTemplateList[] | select(.platform=="reddit")][0]')"
call "$PRIYA_JAR" PUT "/notice-templates/$(jq -r .templateId <<< "$priyaRedditTemplate")" "$(jq -c --arg mark "$PRIYA_TEMPLATE_MARK" '{platform, name, subject, body: (.body + "
" + $mark)}' <<< "$priyaRedditTemplate")"
notice_ready() { curl -s -b "$1" "$BASE_URL/candidates/$2/notice" -o "$WORK_DIR/notice-$2.json" -w '%{http_code}' | grep -q 200; }
# The operator approves one of theirs first (after Priya edited her template)
call "$OPERATOR_JAR" GET '/candidates?status=pending&pageSize=50'
OPERATOR_APPROVE_ID="$(last '[.candidateList[] | select(.candidateId != '"$OPERATOR_CANDIDATE_ID"')][0].candidateId')"
call "$OPERATOR_JAR" POST "/candidates/$OPERATOR_APPROVE_ID/decision" '{"action":"approve","goodFaith":true,"note":"operator"}'
operatorApproveStatus="$HTTP_STATUS"; operatorApproveMessage="$(last '.message // empty')"
operatorNotice=""
if [ "$operatorApproveStatus" = 200 ] && wait_for 24 notice_ready "$OPERATOR_JAR" "$OPERATOR_APPROVE_ID"; then operatorNotice="$(jq -r .noticeText "$WORK_DIR/notice-$OPERATOR_APPROVE_ID.json")"; fi
operatorHasOwnMark="$(grep -c "$OPERATOR_TEMPLATE_MARK" <<< "$operatorNotice")"; operatorHasPriyaMark="$(grep -c "$PRIYA_TEMPLATE_MARK" <<< "$operatorNotice")"
# Then the operator lists the author of Priya's matched post as one of their own accounts. The operator's
# match on the same photo (OPERATOR_CANDIDATE_ID) comes from that author's post too.
call "$PRIYA_JAR" GET "/candidates/$PRIYA_CANDIDATE_ID"; PRIYA_POST_AUTHOR="$(last .postAuthor)"
call "$OPERATOR_JAR" GET "/candidates/$OPERATOR_CANDIDATE_ID"; operatorPostAuthor="$(last .postAuthor)"
call "$OPERATOR_JAR" PUT /creator "$(jq -nc --arg handle "$PRIYA_POST_AUTHOR" '{name: "Olivia Operator", legalName: "Olivia Operator", contactEmail: "olivia@example.com", mailingAddress: "1 Operator Road", ownAccountList: [{platform: "reddit", handle: $handle}]}')"
call "$OPERATOR_JAR" POST "/candidates/$OPERATOR_CANDIDATE_ID/decision" '{"action":"approve","goodFaith":true}'
operatorOwnPostStatus="$HTTP_STATUS (author $operatorPostAuthor)"
call "$PRIYA_JAR" POST "/candidates/$PRIYA_CANDIDATE_ID/decision" '{"action":"approve","goodFaith":true,"note":"mine"}'
approveStatus="$HTTP_STATUS"; approveMessage="$(last '.message // empty')"
wait_for 24 notice_ready "$PRIYA_JAR" "$PRIYA_CANDIDATE_ID"
priyaNotice="$(jq -r '.noticeText // empty' "$WORK_DIR/notice-$PRIYA_CANDIDATE_ID.json" 2> /dev/null)"
hasPriya="$(grep -c "Priya Kapoor" <<< "$priyaNotice")"; hasPriyaMark="$(grep -c "$PRIYA_TEMPLATE_MARK" <<< "$priyaNotice")"
hasOperator="$(grep -cE "Olivia|$OPERATOR_TEMPLATE_MARK" <<< "$priyaNotice")"
if [ "$approveStatus" = 200 ] && [ "$hasPriya" -ge 1 ] && [ "$hasPriyaMark" -ge 1 ] && [ "$hasOperator" = 0 ] && [ "$operatorHasOwnMark" -ge 1 ] && [ "$operatorHasPriyaMark" = 0 ]; then
  record N5 PASS "Priya's notice: her name and PRIYA-TEMPLATE, nothing of the operator's; operator's notice keeps OLD-TEMPLATE-OPERATOR and has no PRIYA-TEMPLATE"
else
  record N5 FAIL "Priya approve $approveStatus $approveMessage; her notice name:$hasPriya mark:$hasPriyaMark operator-bits:$hasOperator; operator approve $operatorApproveStatus $operatorApproveMessage, own mark:$operatorHasOwnMark PRIYA mark:$operatorHasPriyaMark"
fi
[ "$approveStatus" = 200 ] && [[ "$operatorOwnPostStatus" == 422* ]] && record N6 PASS "operator lists u/$PRIYA_POST_AUTHOR as their own: operator's approval refused ($operatorOwnPostStatus); Priya approved her match from u/$PRIYA_POST_AUTHOR (200)"   || record N6 FAIL "operator lists u/$PRIYA_POST_AUTHOR: operator's approval $operatorOwnPostStatus; Priya's approval $approveStatus $approveMessage"

call "$PRIYA_JAR" POST /api-tokens '{"name":"journey test"}'; PRIYA_TOKEN="$(last .apiToken)"
call "$OPERATOR_JAR" GET '/assets?pageSize=5'; OTHER_OPERATOR_ASSET_ID="$(last "[.assetList[] | select(.assetId != $OPERATOR_ASSET_ID)][0].assetId")"
curl -s -b "$OPERATOR_JAR" -o "$WORK_DIR/operator-other.jpg" "$BASE_URL/assets/$OTHER_OPERATOR_ASSET_ID/image"
checkJson="$(curl -s -H "authorization: Bearer $PRIYA_TOKEN" -F "file=@$WORK_DIR/operator-other.jpg" "$BASE_URL/checks")"
foreignInCheck="$(jq "[.matchList[]? | select(.assetId != $PRIYA_ASSET_ID)] | length" <<< "$checkJson" 2> /dev/null)"
tokenListForeign="$(curl -s -H "authorization: Bearer $PRIYA_TOKEN" "$BASE_URL/candidates?status=pending&pageSize=50" | jq "[.candidateList[] | select(.assetId != $PRIYA_ASSET_ID)] | length")"
tokenForeignRead="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $PRIYA_TOKEN" "$BASE_URL/candidates/$OPERATOR_CANDIDATE_ID")"
[ "$foreignInCheck" = 0 ] && [ "$tokenListForeign" = 0 ] && [ "$tokenForeignRead" = 404 ] \
  && record N7 PASS "check of an operator-only image found none of the operator's originals; token list only Priya's; operator candidate 404" \
  || record N7 FAIL "check result $(jq -c '{matchCount: (.matchList // [] | length)}' <<< "$checkJson" 2> /dev/null) foreign $foreignInCheck; token list foreign $tokenListForeign; operator candidate $tokenForeignRead"

call "$PRIYA_JAR" GET /metrics; priyaMetrics="$HTTP_STATUS"
call "$OPERATOR_JAR" GET /metrics; operatorMetrics="$HTTP_STATUS"
[ "$priyaMetrics" = 403 ] && [ "$operatorMetrics" = 200 ] && record N8 PASS "Priya 403, operator 200" || record N8 FAIL "Priya $priyaMetrics, operator $operatorMetrics"

# ---------- Q. Accounts without public sign-up ----------
q1Output="$(add_user friend@example.com "Friend")"; q1Exit=$?
friendPassword="$(grep -oE 'shown once: [A-Za-z0-9_-]+' <<< "$q1Output" | cut -d' ' -f3)"
sign_in "$WORK_DIR/friend.jar" friend@example.com "$friendPassword"; friendStatus="$HTTP_STATUS"
call "$WORK_DIR/friend.jar" GET /notice-templates; friendTemplates="$(last .noticeTemplateCount)"
call "$WORK_DIR/friend.jar" GET '/assets?pageSize=1'; friendAssets="$(last .totalCount)"
[ "$q1Exit" = 0 ] && [ -n "$friendPassword" ] && [ "$friendStatus" = 200 ] && [ "$friendTemplates" = 2 ] && [ "$friendAssets" = 0 ] \
  && record Q1 PASS "created and printed a password once; friend signs in (200) to an empty space with 2 default templates" \
  || record Q1 FAIL "exit $q1Exit; output: $(tr '\n' ' ' <<< "$q1Output" | sed 's/shown once: [A-Za-z0-9_-]*/shown once: ***/'); sign-in $friendStatus; templates $friendTemplates; originals $friendAssets"
q2Output="$(add_user FRIEND@example.com "Again")"; q2Exit=$?
[ "$q2Exit" != 0 ] && grep -q "already exists" <<< "$q2Output" && record Q2 PASS "exit $q2Exit: $(tr '\n' ' ' <<< "$q2Output")" \
  || record Q2 FAIL "exit $q2Exit: $(tr '\n' ' ' <<< "$q2Output")"
q3aOutput="$(add_user not-an-email)"; q3aExit=$?
q3bOutput="$(ADD_USER_PASSWORD=short123 add_user shortpass@example.com)"; q3bExit=$?
shortpassRows="$(sql "SELECT count(*) FROM users WHERE username = 'shortpass@example.com'")"
[ "$q3aExit" != 0 ] && [ "$q3bExit" != 0 ] && [ "$shortpassRows" = 0 ] \
  && record Q3 PASS "bad email: $(tr '\n' ' ' <<< "$q3aOutput")| short password: $(tr '\n' ' ' <<< "$q3bOutput")" \
  || record Q3 FAIL "bad email exit $q3aExit ($(tr '\n' ' ' <<< "$q3aOutput")); short password exit $q3bExit ($(tr '\n' ' ' <<< "$q3bOutput")); accounts $shortpassRows"
ADD_USER_PASSWORD="mixed-case-password-1" add_user Mixed.Case@Example.com "Mixed" > /dev/null
sign_in "$WORK_DIR/mixed.jar" mixed.case@example.com "mixed-case-password-1"
[ "$HTTP_STATUS" = 200 ] && record Q4 PASS "added as Mixed.Case@Example.com, signs in as mixed.case@example.com" || record Q4 FAIL "lower-case sign-in answered $HTTP_STATUS"

# ---------- P. Sign-in limits ----------
flush_redis 'login-failures*'
sign_up "$WORK_DIR/p6.jar" "p6@example.com" "p6-password-123456"
for attemptNumber in 1 2 3; do sign_in "$WORK_DIR/x.jar" p6@example.com wrong-password-1; done
sign_in "$WORK_DIR/p6b.jar" p6@example.com p6-password-123456; p6First="$HTTP_STATUS"
for attemptNumber in $(seq 1 9); do sign_in "$WORK_DIR/x.jar" p6@example.com wrong-password-1; done
sign_in "$WORK_DIR/p6c.jar" p6@example.com p6-password-123456; p6Second="$HTTP_STATUS"
[ "$p6First" = 200 ] && [ "$p6Second" = 200 ] && record P6 PASS "right password after 3 mistakes 200; after 9 more mistakes still 200" \
  || record P6 FAIL "after 3 mistakes $p6First; after 9 more $p6Second"

flush_redis 'login-failures*'
for attemptNumber in $(seq 1 10); do sign_in "$WORK_DIR/x.jar" "$PRIYA_EMAIL" wrong-password-1; done
sign_in "$WORK_DIR/p3.jar" "$PRIYA_EMAIL" "$PRIYA_PASSWORD"; p3Right="$HTTP_STATUS"; p3Message="$(last .message)"
sign_in "$WORK_DIR/p3op.jar" "${ADMIN_USERNAME:-admin}" "$ADMIN_PASSWORD"; p3Operator="$HTTP_STATUS"
[ "$p3Right" = 429 ] && [ "$p3Operator" = 200 ] && record P3 PASS "11th attempt with the right password: 429 \"$p3Message\"; operator unaffected (200)" \
  || record P3 FAIL "right password after 10 mistakes: $p3Right \"$p3Message\"; operator $p3Operator"

flush_redis 'login-failures*'
for attemptNumber in $(seq 1 30); do sign_in "$WORK_DIR/x.jar" "guess-$attemptNumber@example.com" wrong-password-1; done
sign_in "$WORK_DIR/p4.jar" "${ADMIN_USERNAME:-admin}" "$ADMIN_PASSWORD"; p4SameVisitor="$HTTP_STATUS"
p4OtherVisitor="$(curl -s -o /dev/null -w '%{http_code}' -H 'x-forwarded-for: 198.51.100.7' -H 'content-type: application/json' \
  -d "$(credentials_json "${ADMIN_USERNAME:-admin}" "$ADMIN_PASSWORD")" "$DIRECT_API_URL/auth/login")"
[ "$p4SameVisitor" = 429 ] && [ "$p4OtherVisitor" = 200 ] && record P4 PASS "after 30 failures the same visitor gets 429 even for a real account; another visitor 200" \
  || record P4 FAIL "same visitor $p4SameVisitor; other visitor $p4OtherVisitor"

flush_redis 'login-failures*'
p5Blocked=""
for attemptNumber in $(seq 1 40); do
  attemptStatus="$(curl -s -o /dev/null -w '%{http_code}' -H "x-forwarded-for: 203.0.113.$attemptNumber" -H 'content-type: application/json' \
    -d "$(credentials_json "forged-$attemptNumber@example.com" wrong-password-1)" "$BASE_URL/auth/login")"
  [ "$attemptStatus" = 429 ] && { p5Blocked="$attemptNumber"; break; }
done
[ -n "$p5Blocked" ] && [ "$p5Blocked" -le 31 ] && record P5 PASS "local nginx: forged X-Forwarded-For ignored, blocked at attempt $p5Blocked" \
  || record P5 FAIL "local nginx: forged X-Forwarded-For got around the limit (blocked at: ${p5Blocked:-never in 40})"
flush_redis 'login-failures*'

flush_redis 'signups:*'
m10Statuses=""
for attemptNumber in $(seq 1 11); do
  sign_up "$WORK_DIR/m10.jar" "burst-$attemptNumber@example.com" "burst-password-1234"
  m10Statuses+="$HTTP_STATUS "
done
m10Last="$(last .message)"
[ "$m10Statuses" = "201 201 201 201 201 201 201 201 201 201 429 " ] && record M10 PASS "10 × 201 then 429 \"$m10Last\"" \
  || record M10 FAIL "statuses: $m10Statuses ($m10Last)"
flush_redis 'signups:*'

echo "Done: $(grep -c $'\tPASS\t' "$RESULTS_FILE") passed, $(grep -c $'\tFAIL\t' "$RESULTS_FILE") failed"
