//! Kheer registry.
//!
//! Each NEP-171 token is an AI agent. At mint the registry creates a keyless
//! sub-account (the vault) that holds the agent's earnings. Customers pay into
//! escrow here. On acceptance the money moves to the vault. Only the current
//! holder can withdraw, and selling the token hands over the vault, the record
//! and any open jobs. `docs/THREAT_MODEL.md` explains each lock below.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    assert_one_yocto, env, ext_contract, near, require,
};

/// The compiled vault, deployed to each agent's sub-account at mint.
#[cfg(not(test))]
const VAULT_WASM: &[u8] = include_bytes!("../../res/vault.wasm");
#[cfg(test)]
const VAULT_WASM: &[u8] = &[];

/// Pays the vault's own code and state storage (about 0.98 NEAR at 97 KB).
const VAULT_FUNDING: NearToken = NearToken::from_millinear(1100);
/// Vault funding plus token storage and the capped history ring.
const MINT_DEPOSIT: NearToken = NearToken::from_millinear(1500);
/// Non-refundable. Pays storage for one job record and its history entries.
const JOB_FEE: NearToken = NearToken::from_millinear(10);
const MIN_PRICE: NearToken = NearToken::from_millinear(1);

const MAX_METADATA_BYTES: usize = 4096;
/// History per token is a ring of this many entries, so storage stays bounded.
/// Permanent NEP-297 events are emitted for every entry regardless.
const MAX_HISTORY: u32 = 100;

const GAS_VAULT_INIT: Gas = Gas::from_tgas(10);
const GAS_ON_VAULT: Gas = Gas::from_tgas(30);
const GAS_PAY: Gas = Gas::from_tgas(10);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(15);
const MIN_GAS_MINT: Gas = Gas::from_tgas(100);
const MIN_GAS_WITHDRAW: Gas = Gas::from_tgas(40);

#[ext_contract(ext_vault)]
#[allow(dead_code)]
trait Vault {
    fn pay(&mut self, to: AccountId, amount: NearToken) -> Promise;
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Owners,
    Metadata,
    Enumeration,
    Approvals,
    Agents,
    Jobs,
    Customers,
    History,
    TokenJobs,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AgentData {
    pub vault: AccountId,
    /// The account that made the agent. Survives sale, so the skill stays credited.
    pub creator: AccountId,
    /// Runtime allowed to deliver. Cleared on every transfer.
    pub operator: Option<AccountId>,
    pub price: NearToken,
    pub knowledge_hash: Base58CryptoHash,
    pub exam_hash: Option<Base58CryptoHash>,
    pub jobs_total: u32,
    pub jobs_completed: u32,
    pub jobs_refunded: u32,
    pub unique_customers: u32,
    pub rating_sum: u64,
    pub ratings: u32,
    pub lifetime_earned: NearToken,
    pub lifetime_withdrawn: NearToken,
    /// Earned money sitting in the vault that the holder can withdraw.
    pub available: NearToken,
    /// Blocks transfers until the withdrawal's callback has run.
    pub withdrawal_pending: bool,
    /// Set while `nft_transfer_call` is waiting on the receiver.
    pub transfer_locked: bool,
    pub listing: Option<NearToken>,
    pub history_len: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum JobStatus {
    Hired,
    Delivered,
    Accepted,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Job {
    pub id: u64,
    pub token_id: TokenId,
    pub customer: AccountId,
    pub amount: NearToken,
    pub request_hash: Base58CryptoHash,
    pub result_hash: Option<Base58CryptoHash>,
    pub deliver_by_ms: u64,
    pub accept_by_ms: Option<u64>,
    pub status: JobStatus,
    pub rating: Option<u8>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum HistoryKind {
    Minted,
    Hired,
    Delivered,
    Accepted,
    AutoAccepted,
    Refunded,
    Withdrawn,
    WithdrawFailed,
    Transferred,
    Sold,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct HistoryEntry {
    pub seq: u32,
    pub kind: HistoryKind,
    pub account: AccountId,
    pub counterparty: Option<AccountId>,
    pub amount: Option<NearToken>,
    pub job_id: Option<u64>,
    pub timestamp_ms: u64,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub agent: AgentData,
}

#[near(serializers = [json])]
pub struct Config {
    pub mint_deposit: NearToken,
    pub job_fee: NearToken,
    pub deliver_window_ms: u64,
    pub accept_window_ms: u64,
    pub max_history: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    agents: LookupMap<TokenId, AgentData>,
    jobs: Vector<Job>,
    customers: LookupSet<(TokenId, AccountId)>,
    history: LookupMap<(TokenId, u32), HistoryEntry>,
    token_jobs: LookupMap<(TokenId, u32), u64>,
    next_id: u64,
    deliver_window_ms: u64,
    accept_window_ms: u64,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(deliver_window_ms: u64, accept_window_ms: u64) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::Metadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approvals),
            ),
            agents: LookupMap::new(StorageKey::Agents),
            jobs: Vector::new(StorageKey::Jobs),
            customers: LookupSet::new(StorageKey::Customers),
            history: LookupMap::new(StorageKey::History),
            token_jobs: LookupMap::new(StorageKey::TokenJobs),
            next_id: 0,
            deliver_window_ms,
            accept_window_ms,
        }
    }

    // ---- Creating an agent ----

    /// Creates the vault first. The token only exists once the vault does, so
    /// a failed creation leaves nothing to undo except the refund.
    #[payable]
    pub fn mint(
        &mut self,
        metadata: TokenMetadata,
        price: NearToken,
        knowledge_hash: Base58CryptoHash,
        operator: Option<AccountId>,
        exam_hash: Option<Base58CryptoHash>,
    ) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= MINT_DEPOSIT, "Attach at least the mint deposit");
        require!(env::prepaid_gas() >= MIN_GAS_MINT, "Attach at least 100 Tgas");
        require!(price >= MIN_PRICE, "Price is below the minimum");
        require!(
            serde_json::to_vec(&metadata).unwrap().len() <= MAX_METADATA_BYTES,
            "Metadata is too large"
        );

        let id = self.next_id;
        self.next_id += 1;
        let vault: AccountId = format!("a{}.{}", id, env::current_account_id())
            .parse()
            .unwrap();
        let init_args = json!({ "registry": env::current_account_id() })
            .to_string()
            .into_bytes();

        // No add_full_access_key and no add_access_key: the vault has no keys.
        Promise::new(vault.clone())
            .create_account()
            .transfer(VAULT_FUNDING)
            .deploy_contract(VAULT_WASM.to_vec())
            .function_call(
                "new".to_string(),
                init_args,
                NearToken::from_yoctonear(0),
                GAS_VAULT_INIT,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_VAULT).on_vault_created(
                id,
                env::predecessor_account_id(),
                vault,
                metadata,
                price,
                knowledge_hash,
                operator,
                exam_hash,
                deposit,
            ))
    }

    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_vault_created(
        &mut self,
        id: u64,
        owner: AccountId,
        vault: AccountId,
        metadata: TokenMetadata,
        price: NearToken,
        knowledge_hash: Base58CryptoHash,
        operator: Option<AccountId>,
        exam_hash: Option<Base58CryptoHash>,
        deposit: NearToken,
    ) -> Option<TokenId> {
        if !near_sdk::is_promise_success() {
            let _ = Promise::new(owner).transfer(deposit);
            return None;
        }
        let token_id: TokenId = id.to_string();
        self.tokens
            .internal_mint_with_refund(token_id.clone(), owner.clone(), Some(metadata), None);
        NftMint {
            owner_id: &owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();

        let mut agent = AgentData {
            vault,
            creator: owner.clone(),
            operator,
            price,
            knowledge_hash,
            exam_hash,
            jobs_total: 0,
            jobs_completed: 0,
            jobs_refunded: 0,
            unique_customers: 0,
            rating_sum: 0,
            ratings: 0,
            lifetime_earned: NearToken::from_yoctonear(0),
            lifetime_withdrawn: NearToken::from_yoctonear(0),
            available: NearToken::from_yoctonear(0),
            withdrawal_pending: false,
            transfer_locked: false,
            listing: None,
            history_len: 0,
        };
        self.record(&token_id, &mut agent, HistoryKind::Minted, owner.clone(), None, None, None);
        self.agents.insert(token_id.clone(), agent);

        let excess = deposit.saturating_sub(MINT_DEPOSIT);
        if !excess.is_zero() {
            let _ = Promise::new(owner).transfer(excess);
        }
        Some(token_id)
    }

    // ---- Holder settings ----

    #[payable]
    pub fn set_operator(&mut self, token_id: TokenId, operator: Option<AccountId>) {
        let (_, mut agent) = self.require_holder(&token_id);
        agent.operator = operator;
        self.agents.insert(token_id, agent);
    }

    #[payable]
    pub fn set_price(&mut self, token_id: TokenId, price: NearToken) {
        require!(price >= MIN_PRICE, "Price is below the minimum");
        let (_, mut agent) = self.require_holder(&token_id);
        agent.price = price;
        self.agents.insert(token_id, agent);
    }

    #[payable]
    pub fn set_exam(&mut self, token_id: TokenId, exam_hash: Base58CryptoHash) {
        let (_, mut agent) = self.require_holder(&token_id);
        agent.exam_hash = Some(exam_hash);
        self.agents.insert(token_id, agent);
    }

    // ---- Jobs ----

    /// Escrows the price here in the registry, never in the vault, so a holder
    /// cannot withdraw money the agent has not earned yet.
    #[payable]
    pub fn hire(&mut self, token_id: TokenId, request_hash: Base58CryptoHash) -> u64 {
        let mut agent = self.get_agent_data(&token_id);
        require!(agent.operator.is_some(), "This agent has no operator running");
        let required = agent.price.saturating_add(JOB_FEE);
        let deposit = env::attached_deposit();
        require!(deposit >= required, "Attach the price plus the job fee");

        let customer = env::predecessor_account_id();
        let id = self.jobs.len() as u64;
        let now = env::block_timestamp_ms();
        self.jobs.push(Job {
            id,
            token_id: token_id.clone(),
            customer: customer.clone(),
            amount: agent.price,
            request_hash,
            result_hash: None,
            deliver_by_ms: now + self.deliver_window_ms,
            accept_by_ms: None,
            status: JobStatus::Hired,
            rating: None,
        });
        self.token_jobs.insert((token_id.clone(), agent.jobs_total), id);
        agent.jobs_total += 1;
        if self.customers.insert((token_id.clone(), customer.clone())) {
            agent.unique_customers += 1;
        }
        let amount = agent.price;
        self.record(
            &token_id,
            &mut agent,
            HistoryKind::Hired,
            customer.clone(),
            None,
            Some(amount),
            Some(id),
        );
        self.agents.insert(token_id, agent);

        let excess = deposit.saturating_sub(required);
        if !excess.is_zero() {
            let _ = Promise::new(customer).transfer(excess);
        }
        id
    }

    /// Takes no deposit, so the runtime's function-call key can sign it.
    pub fn deliver(&mut self, job_id: u64, result_hash: Base58CryptoHash) {
        let mut job = self.get_job_data(job_id);
        let mut agent = self.get_agent_data(&job.token_id);
        let operator = env::predecessor_account_id();
        require!(agent.operator.as_ref() == Some(&operator), "Only the operator can deliver");
        require!(job.status == JobStatus::Hired, "Job is not waiting for delivery");
        let now = env::block_timestamp_ms();
        require!(now <= job.deliver_by_ms, "Delivery deadline has passed");

        job.status = JobStatus::Delivered;
        job.result_hash = Some(result_hash);
        job.accept_by_ms = Some(now + self.accept_window_ms);
        let token_id = job.token_id.clone();
        self.jobs.replace(job_id as u32, job);
        self.record(
            &token_id,
            &mut agent,
            HistoryKind::Delivered,
            operator,
            None,
            None,
            Some(job_id),
        );
        self.agents.insert(token_id, agent);
    }

    #[payable]
    pub fn accept(&mut self, job_id: u64, rating: u8) {
        assert_one_yocto();
        require!((1..=5).contains(&rating), "Rating must be 1 to 5");
        let job = self.get_job_data(job_id);
        require!(env::predecessor_account_id() == job.customer, "Only the customer can accept");
        require!(job.status == JobStatus::Delivered, "Job has not been delivered");
        self.settle(job, Some(rating), HistoryKind::Accepted);
    }

    /// Anyone can call this once the accept window has passed.
    pub fn finalize(&mut self, job_id: u64) {
        let job = self.get_job_data(job_id);
        require!(job.status == JobStatus::Delivered, "Job has not been delivered");
        require!(
            env::block_timestamp_ms() > job.accept_by_ms.unwrap(),
            "Accept window is still open"
        );
        self.settle(job, None, HistoryKind::AutoAccepted);
    }

    /// Anyone can call this once the delivery deadline has passed undelivered.
    pub fn refund(&mut self, job_id: u64) {
        let mut job = self.get_job_data(job_id);
        require!(job.status == JobStatus::Hired, "Job is not waiting for delivery");
        require!(
            env::block_timestamp_ms() > job.deliver_by_ms,
            "Delivery deadline has not passed"
        );
        let mut agent = self.get_agent_data(&job.token_id);
        agent.jobs_refunded += 1;
        job.status = JobStatus::Refunded;
        let (customer, amount, token_id) = (job.customer.clone(), job.amount, job.token_id.clone());
        self.jobs.replace(job_id as u32, job);
        self.record(
            &token_id,
            &mut agent,
            HistoryKind::Refunded,
            customer.clone(),
            None,
            Some(amount),
            Some(job_id),
        );
        self.agents.insert(token_id, agent);
        let _ = Promise::new(customer).transfer(amount);
    }

    // ---- Money out ----

    /// Pays the holder from the vault. The balance is reduced and the transfer
    /// lock set before the cross-contract call, and the callback undoes both if
    /// the payment fails.
    #[payable]
    pub fn withdraw(&mut self, token_id: TokenId, amount: NearToken) -> Promise {
        let (holder, mut agent) = self.require_holder(&token_id);
        require!(env::prepaid_gas() >= MIN_GAS_WITHDRAW, "Attach at least 40 Tgas");
        require!(!agent.withdrawal_pending, "A withdrawal is already pending");
        require!(!amount.is_zero(), "Amount must be above zero");
        require!(amount <= agent.available, "Amount exceeds the available balance");

        agent.available = agent.available.saturating_sub(amount);
        agent.withdrawal_pending = true;
        let vault = agent.vault.clone();
        self.agents.insert(token_id.clone(), agent);

        ext_vault::ext(vault)
            .with_static_gas(GAS_PAY)
            .pay(holder.clone(), amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_WITHDRAW)
                    .on_withdraw(token_id, amount, holder),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, token_id: TokenId, amount: NearToken, to: AccountId) -> bool {
        let mut agent = self.get_agent_data(&token_id);
        agent.withdrawal_pending = false;
        let ok = near_sdk::is_promise_success();
        let kind = if ok {
            agent.lifetime_withdrawn = agent.lifetime_withdrawn.saturating_add(amount);
            HistoryKind::Withdrawn
        } else {
            agent.available = agent.available.saturating_add(amount);
            HistoryKind::WithdrawFailed
        };
        self.record(&token_id, &mut agent, kind, to, None, Some(amount), None);
        self.agents.insert(token_id, agent);
        ok
    }

    // ---- Selling ----

    #[payable]
    pub fn list_for_sale(&mut self, token_id: TokenId, price: NearToken) {
        require!(!price.is_zero(), "Sale price must be above zero");
        let (_, mut agent) = self.require_holder(&token_id);
        agent.listing = Some(price);
        self.agents.insert(token_id, agent);
    }

    #[payable]
    pub fn cancel_listing(&mut self, token_id: TokenId) {
        let (_, mut agent) = self.require_holder(&token_id);
        agent.listing = None;
        self.agents.insert(token_id, agent);
    }

    /// Buys a listed agent in one step. `min_available` protects the buyer: if
    /// the seller drained the wallet after the buyer looked, the purchase fails
    /// and the buyer keeps their money.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, min_available: NearToken) {
        let agent = self.get_agent_data(&token_id);
        Self::require_transferable(&agent);
        let price = agent.listing.unwrap_or_else(|| env::panic_str("Agent is not for sale"));
        let deposit = env::attached_deposit();
        require!(deposit >= price, "Attach at least the sale price");
        require!(
            agent.available >= min_available,
            "Wallet balance is below your minimum"
        );

        let buyer = env::predecessor_account_id();
        let seller = self.owner_of(&token_id);
        require!(buyer != seller, "You already hold this agent");
        self.tokens.internal_transfer(&seller, &buyer, &token_id, None, None);

        let mut agent = self.after_transfer(&token_id);
        self.record(
            &token_id,
            &mut agent,
            HistoryKind::Sold,
            seller.clone(),
            Some(buyer.clone()),
            Some(price),
            None,
        );
        self.agents.insert(token_id, agent);

        let _ = Promise::new(seller).transfer(price);
        let excess = deposit.saturating_sub(price);
        if !excess.is_zero() {
            let _ = Promise::new(buyer).transfer(excess);
        }
    }

    // ---- Views ----

    pub fn get_config(&self) -> Config {
        Config {
            mint_deposit: MINT_DEPOSIT,
            job_fee: JOB_FEE,
            deliver_window_ms: self.deliver_window_ms,
            accept_window_ms: self.accept_window_ms,
            max_history: MAX_HISTORY,
        }
    }

    pub fn get_agent(&self, token_id: TokenId) -> Option<AgentView> {
        let agent = self.agents.get(&token_id)?.clone();
        Some(AgentView {
            owner_id: self.owner_of(&token_id),
            token_id,
            agent,
        })
    }

    /// Token ids are sequential. An id whose vault creation failed is skipped.
    pub fn get_agents(&self, from_index: u64, limit: u64) -> Vec<AgentView> {
        (from_index..self.next_id)
            .take(limit as usize)
            .filter_map(|i| self.get_agent(i.to_string()))
            .collect()
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(job_id as u32).cloned()
    }

    pub fn get_jobs_count(&self) -> u64 {
        self.jobs.len() as u64
    }

    /// All jobs by index. The runtime polls this for new work.
    pub fn get_jobs(&self, from_index: u64, limit: u64) -> Vec<Job> {
        (from_index..self.jobs.len() as u64)
            .take(limit as usize)
            .filter_map(|i| self.get_job(i))
            .collect()
    }

    pub fn get_agent_jobs(&self, token_id: TokenId, from_index: u32, limit: u32) -> Vec<Job> {
        let total = self.agents.get(&token_id).map_or(0, |a| a.jobs_total);
        (from_index..total)
            .take(limit as usize)
            .filter_map(|i| self.token_jobs.get(&(token_id.clone(), i)))
            .filter_map(|job_id| self.get_job(*job_id))
            .collect()
    }

    /// Oldest surviving entry first. See `MAX_HISTORY`.
    pub fn get_history(&self, token_id: TokenId) -> Vec<HistoryEntry> {
        let len = self.agents.get(&token_id).map_or(0, |a| a.history_len);
        (len.saturating_sub(MAX_HISTORY)..len)
            .filter_map(|seq| self.history.get(&(token_id.clone(), seq % MAX_HISTORY)))
            .cloned()
            .collect()
    }
}

// ---- Internal helpers ----

impl Contract {
    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Agent not found"))
    }

    fn get_agent_data(&self, token_id: &TokenId) -> AgentData {
        self.agents
            .get(token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Agent not found"))
    }

    fn get_job_data(&self, job_id: u64) -> Job {
        self.get_job(job_id).unwrap_or_else(|| env::panic_str("Job not found"))
    }

    /// Every holder-only action goes through here.
    fn require_holder(&self, token_id: &TokenId) -> (AccountId, AgentData) {
        assert_one_yocto();
        let holder = self.owner_of(token_id);
        require!(env::predecessor_account_id() == holder, "Only the holder can do this");
        let agent = self.get_agent_data(token_id);
        require!(!agent.transfer_locked, "A transfer is in progress");
        (holder, agent)
    }

    fn require_transferable(agent: &AgentData) {
        require!(!agent.withdrawal_pending, "A withdrawal is pending");
        require!(!agent.transfer_locked, "A transfer is in progress");
    }

    /// Cuts the old holder's access. Approvals are cleared by the NFT standard.
    fn after_transfer(&mut self, token_id: &TokenId) -> AgentData {
        let mut agent = self.get_agent_data(token_id);
        agent.operator = None;
        agent.listing = None;
        agent
    }

    /// Credits the vault before sending, so the record and money cannot diverge.
    fn settle(&mut self, mut job: Job, rating: Option<u8>, kind: HistoryKind) {
        let mut agent = self.get_agent_data(&job.token_id);
        agent.jobs_completed += 1;
        agent.lifetime_earned = agent.lifetime_earned.saturating_add(job.amount);
        agent.available = agent.available.saturating_add(job.amount);
        if let Some(r) = rating {
            agent.rating_sum += r as u64;
            agent.ratings += 1;
        }
        job.status = JobStatus::Accepted;
        job.rating = rating;
        let (id, amount, customer, token_id) =
            (job.id, job.amount, job.customer.clone(), job.token_id.clone());
        self.jobs.replace(id as u32, job);
        let vault = agent.vault.clone();
        self.record(&token_id, &mut agent, kind, customer, None, Some(amount), Some(id));
        self.agents.insert(token_id, agent);
        let _ = Promise::new(vault).transfer(amount);
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &mut self,
        token_id: &TokenId,
        agent: &mut AgentData,
        kind: HistoryKind,
        account: AccountId,
        counterparty: Option<AccountId>,
        amount: Option<NearToken>,
        job_id: Option<u64>,
    ) {
        let entry = HistoryEntry {
            seq: agent.history_len,
            kind,
            account,
            counterparty,
            amount,
            job_id,
            timestamp_ms: env::block_timestamp_ms(),
        };
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({
                "standard": "kheer",
                "version": "1.0.0",
                "event": entry.kind,
                "data": [{ "token_id": token_id, "entry": entry }],
            })
        ));
        self.history
            .insert((token_id.clone(), agent.history_len % MAX_HISTORY), entry);
        agent.history_len += 1;
    }

    /// Makes the token's metadata reflect the agent's live record.
    fn decorate(&self, mut token: Token) -> Token {
        if let (Some(agent), Some(meta)) = (self.agents.get(&token.token_id), token.metadata.as_mut())
        {
            let label = meta.extra.take();
            meta.extra = Some(
                json!({
                    "label": label,
                    "vault": agent.vault,
                    "jobs_completed": agent.jobs_completed,
                    "jobs_refunded": agent.jobs_refunded,
                    "unique_customers": agent.unique_customers,
                    "rating_sum": agent.rating_sum,
                    "ratings": agent.ratings,
                    "lifetime_earned": agent.lifetime_earned,
                    "exam_passed": agent.exam_hash.is_some(),
                })
                .to_string(),
            );
        }
        token
    }
}

// ---- NEP-171, wrapped so the locks apply to every path ----

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        Self::require_transferable(&self.get_agent_data(&token_id));
        let previous = self.owner_of(&token_id);
        self.tokens
            .nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        let mut agent = self.after_transfer(&token_id);
        self.record(
            &token_id,
            &mut agent,
            HistoryKind::Transferred,
            previous,
            Some(receiver_id),
            None,
            None,
        );
        self.agents.insert(token_id, agent);
    }

    /// The receiver is the holder only provisionally until the resolve step,
    /// so the agent stays locked for that whole window.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        Self::require_transferable(&self.get_agent_data(&token_id));
        let result =
            self.tokens
                .nft_transfer_call(receiver_id, token_id.clone(), approval_id, memo, msg);
        let mut agent = self.after_transfer(&token_id);
        agent.transfer_locked = true;
        self.agents.insert(token_id, agent);
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id).map(|t| self.decorate(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let transferred = self.tokens.nft_resolve_transfer(
            previous_owner_id.clone(),
            receiver_id.clone(),
            token_id.clone(),
            approved_account_ids,
        );
        let mut agent = self.get_agent_data(&token_id);
        agent.transfer_locked = false;
        if transferred {
            self.record(
                &token_id,
                &mut agent,
                HistoryKind::Transferred,
                previous_owner_id,
                Some(receiver_id),
                None,
                None,
            );
        }
        self.agents.insert(token_id, agent);
        transferred
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|t| self.decorate(t))
            .collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|t| self.decorate(t))
            .collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Kheer Agents".to_string(),
            symbol: "KHEER".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
