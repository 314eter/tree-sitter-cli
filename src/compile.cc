#include "./compile.h"
#include "tree_sitter/compiler.h"
#include <utility>

using namespace v8;
using namespace tree_sitter::rules;
using tree_sitter::Grammar;
using tree_sitter::Conflict;
using tree_sitter::GrammarError;
using std::string;
using std::get;
using std::pair;
using std::tuple;
using std::vector;

static std::string StringFromJsString(Handle<String> js_string) {
  String::Utf8Value utf8_string(js_string);
  return std::string(*utf8_string);
}

template<typename T>
Handle<T> ObjectGet(Handle<Object> object, const char *key) {
  return Handle<T>::Cast(object->Get(String::NewSymbol(key)));
}

template<typename T>
Handle<T> ArrayGet(Handle<Array> array, uint32_t i) {
  return Handle<T>::Cast(array->Get(i));
}

rule_ptr RuleFromJsRule(Handle<Object> js_rule) {
  if (!js_rule->IsObject()) {
    ThrowException(Exception::TypeError(String::New("Expected rule to be an object")));
    return rule_ptr();
  }

  Handle<String> js_type = ObjectGet<String>(js_rule, "type");
  if (!js_type->IsString()) {
    ThrowException(Exception::TypeError(String::New("Expected rule type to be a string")));
    return rule_ptr();
  }

  string type = StringFromJsString(js_type);
  if (type == "BLANK")
    return blank();

  if (type == "CHOICE") {
    Handle<Array> js_members = ObjectGet<Array>(js_rule, "members");
    vector<rule_ptr> members;
    uint32_t length = js_members->Length();
    for (uint32_t i = 0; i < length; i++) {
      Handle<Object> js_member = ArrayGet<Object>(js_members, i);
      members.push_back(RuleFromJsRule(js_member));
    }
    return choice(members);
  }

  if (type == "ERROR")
    return err(RuleFromJsRule(ObjectGet<Object>(js_rule, "value")));

  if (type == "PATTERN")
    return pattern(StringFromJsString(ObjectGet<String>(js_rule, "value")));

  if (type == "REPEAT")
    return repeat(RuleFromJsRule(ObjectGet<Object>(js_rule, "value")));

  if (type == "SEQ") {
    Handle<Array> js_members = ObjectGet<Array>(js_rule, "members");
    vector<rule_ptr> members;
    uint32_t length = js_members->Length();
    for (uint32_t i = 0; i < length; i++) {
      Handle<Object> js_member = ArrayGet<Object>(js_members, i);
      members.push_back(RuleFromJsRule(js_member));
    }
    return seq(members);
  }

  if (type == "STRING")
    return str(StringFromJsString(ObjectGet<String>(js_rule, "value")));

  if (type == "SYMBOL")
    return sym(StringFromJsString(ObjectGet<String>(js_rule, "name")));

  ThrowException(Exception::TypeError(String::Concat(String::New("Unexpected rule type: "), js_type)));
  return rule_ptr();
}

pair<Grammar, bool> GrammarFromJsGrammar(Handle<Object> js_grammar) {
  Handle<Object> js_rules = ObjectGet<Object>(js_grammar, "rules");
  if (!js_rules->IsObject())
    ThrowException(Exception::TypeError(String::New("Expected grammar rules to be an object")));

  vector<pair<string, rule_ptr>> rules;
  Local<Array> rule_names = js_rules->GetOwnPropertyNames();
  uint32_t length = rule_names->Length();
  for (uint32_t i = 0; i < length; i++) {
    Local<String> js_rule_name = Local<String>::Cast(rule_names->Get(i));
    string rule_name = StringFromJsString(js_rule_name);
    rule_ptr rule = RuleFromJsRule(Handle<Object>::Cast(js_rules->Get(js_rule_name)));
    if (rule.get()) {
      rules.push_back({ rule_name, rule });
    } else {
      return { Grammar({}), false };
    }
  }

  return { Grammar(rules), true };
}

Handle<Value> Compile(const Arguments &args) {
  HandleScope scope;

  Handle<Object> js_grammar = Handle<Object>::Cast(args[0]);
  if (!js_grammar->IsObject())
    return ThrowException(Exception::TypeError(String::New("Expected grammar to be an object")));

  Handle<String> js_name = ObjectGet<String>(js_grammar, "name");
  if (!js_name->IsString())
    return ThrowException(Exception::TypeError(String::New("Expected grammar name to be a string")));

  string name = StringFromJsString(js_name);

  pair<Grammar, bool> grammarResult = GrammarFromJsGrammar(js_grammar);
  if (!grammarResult.second)
    return scope.Close(Undefined());

  tuple<string, vector<Conflict>, const GrammarError *> result = tree_sitter::compile(grammarResult.first, name);
  return scope.Close(String::New(get<0>(result).c_str()));
}
