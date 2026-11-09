//! Unit tests for every money path and every transfer lock.
//!
//! Cross-contract outcomes are simulated by calling each callback directly with
//! a success or failure promise result. `scripts/testnet-e2e` runs the same
//! paths for real on testnet.

use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const REG: &str = "reg.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const CAROL: &str = "carol.testnet";
const OPERATOR: &str = "runtime.testnet";
const VAULT: &str = "a0.reg.testnet";
const TOKEN: &str = "0";
const DELIVER_WINDOW: u64 = 1_000;
const ACCEPT_WINDOW: u64 = 2_000;
const T0: u64 = 1_000_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}
fn yocto1() -> NearToken {
    NearToken::from_yoctonear(1)
}
fn zero() -> NearToken {
    NearToken::from_yoctonear(0)
}
fn hash(b: u8) -> Base58CryptoHash {
    Base58CryptoHash::from([b; 32])
}
fn tok() -> TokenId {
    TOKEN.to_string()
}

fn call(who: &str, deposit: NearToken, now_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct(REG))
            .predecessor_account_id(acct(who))
            .signer_account_id(acct(who))
            .attached_deposit(deposit)
            .account_balance(near(1000))
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(now_ms * 1_000_000)
            .build()
    );
}

fn callback(result: PromiseResult, now_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct(REG))
            .predecessor_account_id(acct(REG))
            .account_balance(near(1000))
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(now_ms * 1_000_000)
            .build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn meta() -> TokenMetadata {
    TokenMetadata {
        title: Some("Resume reviewer".to_string()),
        description: None,
        media: None,
        media_hash: None,
        copies: None,
        issued_at: None,
        expires_at: None,
        starts_at: None,
        updated_at: None,
        extra: None,
        reference: None,
        reference_hash: None,
    }
}

/// A registry holding one agent owned by Alice, price 1 NEAR, operator set.
fn with_agent() -> Contract {
    call(REG, zero(), T0);
    let mut c = Contract::new(DELIVER_WINDOW, ACCEPT_WINDOW);
    c.next_id = 1;
    callback(ok(), T0);
    c.on_vault_created(0, acct(ALICE), acct(VAULT), meta(), near(1), hash(9), None, None, MINT_DEPOSIT);
    call(ALICE, yocto1(), T0);
    c.set_operator(tok(), Some(acct(OPERATOR)));
    c
}

fn hire_by(c: &mut Contract, who: &str) -> u64 {
    call(who, near(1).saturating_add(JOB_FEE), T0);
    c.hire(tok(), hash(1))
}

fn deliver(c: &mut Contract, job: u64) {
    call(OPERATOR, zero(), T0 + 1);
    c.deliver(job, hash(2));
}

/// Alice's agent with one accepted job, so 1 NEAR is available.
fn with_earnings() -> Contract {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(BOB, yocto1(), T0 + 2);
    c.accept(job, 5);
    c
}

fn agent(c: &Contract) -> AgentData {
    c.get_agent(tok()).unwrap().agent
}
fn owner(c: &Contract) -> AccountId {
    c.get_agent(tok()).unwrap().owner_id
}
fn kinds(c: &Contract) -> Vec<HistoryKind> {
    c.get_history(tok()).into_iter().map(|e| e.kind).collect()
}
fn begin_withdraw(c: &mut Contract) {
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.withdraw(tok(), near(1));
}
fn transfer_to(c: &mut Contract, from: &str, to: &str) {
    call(from, yocto1(), T0 + 3);
    c.nft_transfer(acct(to), tok(), None, None);
}

// ---- Mint ----

#[test]
fn mint_creates_a_vault_with_no_access_keys() {
    call(REG, zero(), T0);
    let mut c = Contract::new(DELIVER_WINDOW, ACCEPT_WINDOW);
    call(ALICE, MINT_DEPOSIT, T0);
    let _ = c.mint(meta(), near(1), hash(9), None, None);
    let receipts = format!("{:?}", get_created_receipts());
    assert!(receipts.contains("CreateAccount"), "{receipts}");
    assert!(receipts.contains("a0.reg.testnet"), "{receipts}");
    assert!(!receipts.contains("AddKey"), "vault must have no keys: {receipts}");
    // The token does not exist until the vault callback confirms.
    assert_eq!(c.nft_total_supply().0, 0);
}

#[test]
#[should_panic(expected = "Attach at least the mint deposit")]
fn mint_requires_the_deposit() {
    call(REG, zero(), T0);
    let mut c = Contract::new(DELIVER_WINDOW, ACCEPT_WINDOW);
    call(ALICE, near(1), T0);
    let _ = c.mint(meta(), near(1), hash(9), None, None);
}

#[test]
fn failed_vault_creation_mints_nothing_and_refunds() {
    call(REG, zero(), T0);
    let mut c = Contract::new(DELIVER_WINDOW, ACCEPT_WINDOW);
    callback(PromiseResult::Failed, T0);
    let r = c.on_vault_created(0, acct(ALICE), acct(VAULT), meta(), near(1), hash(9), None, None, MINT_DEPOSIT);
    assert!(r.is_none());
    assert_eq!(c.nft_total_supply().0, 0);
    assert!(format!("{:?}", get_created_receipts()).contains(ALICE));
}

// ---- Hire, deliver, accept ----

#[test]
fn hire_escrows_without_crediting_the_wallet() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    assert_eq!(c.get_job(job).unwrap().status, JobStatus::Hired);
    assert_eq!(agent(&c).available, zero());
    assert_eq!(agent(&c).unique_customers, 1);
}

#[test]
#[should_panic(expected = "Attach the price plus the job fee")]
fn hire_requires_full_payment() {
    let mut c = with_agent();
    call(BOB, near(1), T0);
    c.hire(tok(), hash(1));
}

#[test]
#[should_panic(expected = "This agent has no operator running")]
fn hire_rejected_without_operator() {
    let mut c = with_agent();
    call(ALICE, yocto1(), T0);
    c.set_operator(tok(), None);
    hire_by(&mut c, BOB);
}

#[test]
#[should_panic(expected = "Only the operator can deliver")]
fn only_operator_delivers() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    call(ALICE, zero(), T0 + 1);
    c.deliver(job, hash(2));
}

#[test]
#[should_panic(expected = "Delivery deadline has passed")]
fn cannot_deliver_late() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    call(OPERATOR, zero(), T0 + DELIVER_WINDOW + 1);
    c.deliver(job, hash(2));
}

#[test]
fn accept_releases_escrow_to_the_vault() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(BOB, yocto1(), T0 + 2);
    c.accept(job, 4);
    let a = agent(&c);
    assert_eq!(a.available, near(1));
    assert_eq!(a.lifetime_earned, near(1));
    assert_eq!(a.jobs_completed, 1);
    assert_eq!((a.rating_sum, a.ratings), (4, 1));
    assert!(format!("{:?}", get_created_receipts()).contains(VAULT));
}

#[test]
#[should_panic(expected = "Only the customer can accept")]
fn only_customer_accepts() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(CAROL, yocto1(), T0 + 2);
    c.accept(job, 5);
}

#[test]
#[should_panic(expected = "Job has not been delivered")]
fn cannot_accept_twice() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(BOB, yocto1(), T0 + 2);
    c.accept(job, 5);
    call(BOB, yocto1(), T0 + 3);
    c.accept(job, 5);
}

#[test]
#[should_panic(expected = "Rating must be 1 to 5")]
fn rating_is_bounded() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(BOB, yocto1(), T0 + 2);
    c.accept(job, 6);
}

// ---- Timing ----

#[test]
#[should_panic(expected = "Accept window is still open")]
fn finalize_waits_for_the_window() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(CAROL, zero(), T0 + 1 + ACCEPT_WINDOW);
    c.finalize(job);
}

#[test]
fn finalize_after_the_window_pays_with_no_rating() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(CAROL, zero(), T0 + 2 + ACCEPT_WINDOW);
    c.finalize(job);
    let a = agent(&c);
    assert_eq!(a.available, near(1));
    assert_eq!(a.ratings, 0);
    assert!(kinds(&c).contains(&HistoryKind::AutoAccepted));
}

#[test]
#[should_panic(expected = "Delivery deadline has not passed")]
fn refund_waits_for_the_deadline() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    call(CAROL, zero(), T0 + DELIVER_WINDOW);
    c.refund(job);
}

#[test]
fn refund_after_the_deadline_returns_escrow() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    call(CAROL, zero(), T0 + DELIVER_WINDOW + 1);
    c.refund(job);
    assert_eq!(c.get_job(job).unwrap().status, JobStatus::Refunded);
    assert_eq!(agent(&c).jobs_refunded, 1);
    assert_eq!(agent(&c).available, zero());
    assert!(format!("{:?}", get_created_receipts()).contains(BOB));
}

#[test]
#[should_panic(expected = "Job is not waiting for delivery")]
fn delivered_job_cannot_be_refunded() {
    let mut c = with_agent();
    let job = hire_by(&mut c, BOB);
    deliver(&mut c, job);
    call(CAROL, zero(), T0 + DELIVER_WINDOW + 1);
    c.refund(job);
}

// ---- Withdraw ----

#[test]
#[should_panic(expected = "Only the holder can do this")]
fn non_holder_cannot_withdraw() {
    let mut c = with_earnings();
    call(BOB, yocto1(), T0 + 3);
    let _ = c.withdraw(tok(), near(1));
}

#[test]
#[should_panic(expected = "Amount exceeds the available balance")]
fn escrow_cannot_be_withdrawn() {
    let mut c = with_agent();
    hire_by(&mut c, BOB);
    begin_withdraw(&mut c);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_requires_one_yocto() {
    let mut c = with_earnings();
    call(ALICE, zero(), T0 + 3);
    let _ = c.withdraw(tok(), near(1));
}

#[test]
fn successful_withdrawal_clears_the_lock() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    assert!(agent(&c).withdrawal_pending);
    assert_eq!(agent(&c).available, zero());
    callback(ok(), T0 + 4);
    assert!(c.on_withdraw(tok(), near(1), acct(ALICE)));
    let a = agent(&c);
    assert!(!a.withdrawal_pending);
    assert_eq!(a.lifetime_withdrawn, near(1));
    assert!(kinds(&c).contains(&HistoryKind::Withdrawn));
}

/// Threat 2: the balance comes back if the payment fails.
#[test]
fn failed_withdrawal_restores_the_balance() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    callback(PromiseResult::Failed, T0 + 4);
    assert!(!c.on_withdraw(tok(), near(1), acct(ALICE)));
    let a = agent(&c);
    assert!(!a.withdrawal_pending);
    assert_eq!(a.available, near(1));
    assert_eq!(a.lifetime_withdrawn, zero());
    assert!(kinds(&c).contains(&HistoryKind::WithdrawFailed));
}

#[test]
#[should_panic(expected = "A withdrawal is already pending")]
fn cannot_withdraw_twice_at_once() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.withdraw(tok(), NearToken::from_millinear(100));
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.withdraw(tok(), NearToken::from_millinear(100));
}

// ---- Threat 1: a sale in the middle of a payout ----

#[test]
#[should_panic(expected = "A withdrawal is pending")]
fn nft_transfer_blocked_during_withdrawal() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    transfer_to(&mut c, ALICE, BOB);
}

#[test]
#[should_panic(expected = "A withdrawal is pending")]
fn nft_transfer_call_blocked_during_withdrawal() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.nft_transfer_call(acct(BOB), tok(), None, None, String::new());
}

#[test]
#[should_panic(expected = "A withdrawal is pending")]
fn buy_blocked_during_withdrawal() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    c.list_for_sale(tok(), near(5));
    begin_withdraw(&mut c);
    call(CAROL, near(5), T0 + 3);
    c.buy(tok(), zero());
}

#[test]
#[should_panic(expected = "A withdrawal is pending")]
fn approved_marketplace_blocked_during_withdrawal() {
    let mut c = with_earnings();
    call(ALICE, NearToken::from_millinear(10), T0 + 3);
    let _ = c.nft_approve(tok(), acct(CAROL), None);
    begin_withdraw(&mut c);
    call(CAROL, yocto1(), T0 + 3);
    c.nft_transfer(acct(BOB), tok(), Some(1), None);
}

#[test]
fn transfer_works_once_the_withdrawal_resolves() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    callback(ok(), T0 + 4);
    c.on_withdraw(tok(), near(1), acct(ALICE));
    transfer_to(&mut c, ALICE, BOB);
    assert_eq!(owner(&c), acct(BOB));
}

// ---- Threats 3 and 4: what the transfer takes away ----

#[test]
fn transfer_clears_operator_listing_and_approvals() {
    let mut c = with_earnings();
    call(ALICE, NearToken::from_millinear(10), T0 + 3);
    let _ = c.nft_approve(tok(), acct(CAROL), None);
    call(ALICE, yocto1(), T0 + 3);
    c.list_for_sale(tok(), near(5));
    transfer_to(&mut c, ALICE, BOB);
    let a = agent(&c);
    assert!(a.operator.is_none());
    assert!(a.listing.is_none());
    assert!(!c.nft_is_approved(tok(), acct(CAROL), None));
}

#[test]
#[should_panic(expected = "Only the holder can do this")]
fn old_holder_cannot_withdraw_after_transfer() {
    let mut c = with_earnings();
    transfer_to(&mut c, ALICE, BOB);
    begin_withdraw(&mut c);
}

#[test]
#[should_panic(expected = "Only the holder can do this")]
fn old_holder_cannot_reinstall_an_operator() {
    let mut c = with_earnings();
    transfer_to(&mut c, ALICE, BOB);
    call(ALICE, yocto1(), T0 + 4);
    c.set_operator(tok(), Some(acct(OPERATOR)));
}

#[test]
fn new_holder_can_withdraw_the_previous_earnings() {
    let mut c = with_earnings();
    transfer_to(&mut c, ALICE, BOB);
    call(BOB, yocto1(), T0 + 4);
    let _ = c.withdraw(tok(), near(1));
    assert!(agent(&c).withdrawal_pending);
}

/// Threat 4: an old operator cannot finish a job after the sale.
#[test]
#[should_panic(expected = "Only the operator can deliver")]
fn old_operator_cannot_deliver_after_transfer() {
    let mut c = with_agent();
    let job = hire_by(&mut c, CAROL);
    transfer_to(&mut c, ALICE, BOB);
    deliver(&mut c, job);
}

/// Threat 7: escrow and the obligation follow the token.
#[test]
fn open_job_earnings_go_to_the_new_holder() {
    let mut c = with_agent();
    let job = hire_by(&mut c, CAROL);
    transfer_to(&mut c, ALICE, BOB);
    call(BOB, yocto1(), T0 + 4);
    c.set_operator(tok(), Some(acct(OPERATOR)));
    deliver(&mut c, job);
    call(CAROL, yocto1(), T0 + 5);
    c.accept(job, 5);
    assert_eq!(agent(&c).available, near(1));
    call(BOB, yocto1(), T0 + 6);
    let _ = c.withdraw(tok(), near(1));
    assert!(agent(&c).withdrawal_pending);
}

// ---- nft_transfer_call window ----

#[test]
fn transfer_call_locks_until_resolved() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.nft_transfer_call(acct(BOB), tok(), None, None, String::new());
    assert!(agent(&c).transfer_locked);
    assert_eq!(owner(&c), acct(BOB));
    callback(PromiseResult::Successful(b"false".to_vec()), T0 + 4);
    assert!(c.nft_resolve_transfer(acct(ALICE), acct(BOB), tok(), None));
    assert!(!agent(&c).transfer_locked);
    assert_eq!(owner(&c), acct(BOB));
    assert!(kinds(&c).contains(&HistoryKind::Transferred));
}

#[test]
fn rejected_transfer_call_returns_the_token() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.nft_transfer_call(acct(BOB), tok(), None, None, String::new());
    callback(PromiseResult::Successful(b"true".to_vec()), T0 + 4);
    assert!(!c.nft_resolve_transfer(acct(ALICE), acct(BOB), tok(), None));
    assert_eq!(owner(&c), acct(ALICE));
    assert!(!agent(&c).transfer_locked);
    assert!(!kinds(&c).contains(&HistoryKind::Transferred));
}

#[test]
#[should_panic(expected = "A transfer is in progress")]
fn provisional_receiver_cannot_withdraw() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    let _ = c.nft_transfer_call(acct(BOB), tok(), None, None, String::new());
    call(BOB, yocto1(), T0 + 3);
    let _ = c.withdraw(tok(), near(1));
}

// ---- Buying ----

#[test]
fn buy_moves_token_and_pays_seller() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    c.list_for_sale(tok(), near(5));
    call(CAROL, near(6), T0 + 4);
    c.buy(tok(), near(1));
    assert_eq!(owner(&c), acct(CAROL));
    let a = agent(&c);
    assert!(a.listing.is_none());
    assert!(a.operator.is_none());
    assert_eq!(a.available, near(1));
    let receipts = format!("{:?}", get_created_receipts());
    assert!(receipts.contains(ALICE) && receipts.contains(CAROL), "{receipts}");
    assert!(kinds(&c).contains(&HistoryKind::Sold));
}

/// Threat 6: a seller drains the wallet just before the buyer's purchase lands.
#[test]
#[should_panic(expected = "Wallet balance is below your minimum")]
fn buyer_is_protected_from_a_last_second_drain() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    c.list_for_sale(tok(), near(5));
    begin_withdraw(&mut c);
    callback(ok(), T0 + 4);
    c.on_withdraw(tok(), near(1), acct(ALICE));
    call(CAROL, near(5), T0 + 5);
    c.buy(tok(), near(1));
}

#[test]
#[should_panic(expected = "Agent is not for sale")]
fn cannot_buy_unlisted() {
    let mut c = with_earnings();
    call(CAROL, near(5), T0 + 4);
    c.buy(tok(), zero());
}

#[test]
#[should_panic(expected = "Attach at least the sale price")]
fn buy_needs_full_price() {
    let mut c = with_earnings();
    call(ALICE, yocto1(), T0 + 3);
    c.list_for_sale(tok(), near(5));
    call(CAROL, near(4), T0 + 4);
    c.buy(tok(), zero());
}

// ---- Record ----

#[test]
fn history_shows_the_whole_life_of_an_agent() {
    let mut c = with_earnings();
    begin_withdraw(&mut c);
    callback(ok(), T0 + 4);
    c.on_withdraw(tok(), near(1), acct(ALICE));
    transfer_to(&mut c, ALICE, BOB);
    assert_eq!(
        kinds(&c),
        vec![
            HistoryKind::Minted,
            HistoryKind::Hired,
            HistoryKind::Delivered,
            HistoryKind::Accepted,
            HistoryKind::Withdrawn,
            HistoryKind::Transferred,
        ]
    );
    let t = c.get_history(tok()).pop().unwrap();
    assert_eq!(t.account, acct(ALICE));
    assert_eq!(t.counterparty, Some(acct(BOB)));
}

#[test]
fn history_is_capped_and_keeps_the_newest() {
    let mut c = with_agent();
    let mut a = agent(&c);
    for _ in 0..(MAX_HISTORY + 10) {
        // A fresh call each time, because one call has a log size limit.
        call(BOB, zero(), T0);
        c.record(&tok(), &mut a, HistoryKind::Delivered, acct(BOB), None, None, None);
    }
    c.agents.insert(tok(), a);
    let h = c.get_history(tok());
    assert_eq!(h.len() as u32, MAX_HISTORY);
    assert_eq!(h.last().unwrap().seq, MAX_HISTORY + 10);
    assert_eq!(h[0].seq, 11);
}

#[test]
fn metadata_reflects_the_live_record() {
    let c = with_earnings();
    let extra = c.nft_token(tok()).unwrap().metadata.unwrap().extra.unwrap();
    let v: serde_json::Value = serde_json::from_str(&extra).unwrap();
    assert_eq!(v["jobs_completed"], 1);
    assert_eq!(v["ratings"], 1);
    assert_eq!(v["rating_sum"], 5);
    assert_eq!(v["exam_passed"], false);
    assert_eq!(v["vault"], VAULT);
}

#[test]
fn agent_job_list_is_per_token() {
    let mut c = with_agent();
    let first = hire_by(&mut c, BOB);
    let second = hire_by(&mut c, CAROL);
    let jobs = c.get_agent_jobs(tok(), 0, 10);
    assert_eq!(jobs.iter().map(|j| j.id).collect::<Vec<_>>(), vec![first, second]);
    assert_eq!(agent(&c).unique_customers, 2);
}

#[test]
fn repeat_customers_count_once() {
    let mut c = with_agent();
    hire_by(&mut c, BOB);
    hire_by(&mut c, BOB);
    assert_eq!(agent(&c).unique_customers, 1);
}

#[test]
fn mint_can_set_operator_and_exam_in_one_step() {
    call(REG, zero(), T0);
    let mut c = Contract::new(DELIVER_WINDOW, ACCEPT_WINDOW);
    let mut m = meta();
    m.extra = Some("synthetic".to_string());
    callback(ok(), T0);
    c.on_vault_created(0, acct(ALICE), acct(VAULT), m, near(1), hash(9), Some(acct(OPERATOR)), Some(hash(7)), MINT_DEPOSIT);
    let a = agent(&c);
    assert_eq!(a.operator, Some(acct(OPERATOR)));
    assert!(a.exam_hash.is_some());
    let extra = c.nft_token(tok()).unwrap().metadata.unwrap().extra.unwrap();
    let v: serde_json::Value = serde_json::from_str(&extra).unwrap();
    assert_eq!(v["label"], "synthetic");
    assert_eq!(v["exam_passed"], true);
}
