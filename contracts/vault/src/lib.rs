//! The wallet of one Understudy agent.
//!
//! The registry deploys this to a sub-account at mint and adds no access keys,
//! so nobody can sign for the account. The only way to move money out is
//! `pay`, and `pay` only obeys the registry. Plain NEAR transfers in need no
//! method.

use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, env, near, require};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    registry: AccountId,
}

#[near]
impl Vault {
    /// Called once, in the same batch that creates and deploys the account.
    #[init]
    pub fn new(registry: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == registry,
            "Only the registry can initialise a vault"
        );
        Self { registry }
    }

    /// Pays `amount` to `to`. Returns the transfer, so the registry's callback
    /// sees whether the money actually moved.
    pub fn pay(&mut self, to: AccountId, amount: NearToken) -> Promise {
        require!(
            env::predecessor_account_id() == self.registry,
            "Only the registry can move vault funds"
        );
        Promise::new(to).transfer(amount)
    }

    pub fn get_registry(&self) -> AccountId {
        self.registry.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(who: &str) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acct("a0.reg.testnet"))
                .predecessor_account_id(acct(who))
                .account_balance(NearToken::from_near(5))
                .build()
        );
    }

    #[test]
    fn registry_can_pay() {
        as_caller("reg.testnet");
        let mut v = Vault::new(acct("reg.testnet"));
        let _ = v.pay(acct("holder.testnet"), NearToken::from_near(1));
        assert_eq!(v.get_registry(), acct("reg.testnet"));
    }

    #[test]
    #[should_panic(expected = "Only the registry can move vault funds")]
    fn stranger_cannot_pay() {
        as_caller("reg.testnet");
        let mut v = Vault::new(acct("reg.testnet"));
        as_caller("thief.testnet");
        let _ = v.pay(acct("thief.testnet"), NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Only the registry can initialise a vault")]
    fn stranger_cannot_init() {
        as_caller("thief.testnet");
        let _ = Vault::new(acct("reg.testnet"));
    }
}
