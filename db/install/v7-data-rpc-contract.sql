-- V7 PostgreSQL data and RPC contract.
-- This installer intentionally replaces the previous experimental V7 objects.
-- It preserves the approved system_builtin skill rows that already exist in
-- zh_narrative, then re-materializes them into the canonical skill contract.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TEMP TABLE _v7_skill_seed (
  id uuid,
  skill_id uuid,
  stable_slug text,
  version integer,
  source_type text,
  owner_local_operator_id uuid,
  source_locator text,
  source_sha256 text,
  skill_name text,
  skill_category text,
  skill_description text,
  applicable_stages jsonb,
  applicable_scopes jsonb,
  constraint_fields jsonb,
  template_fields jsonb,
  skill_config_jsonb jsonb,
  lifecycle_status text,
  created_at timestamptz,
  updated_at timestamptz
) ON COMMIT DROP;

DO $$
BEGIN
  IF to_regclass('public.skill') IS NOT NULL THEN
    INSERT INTO _v7_skill_seed
    SELECT id, skill_id, stable_slug, version, source_type,
           owner_local_operator_id, source_locator, source_sha256,
           skill_name, skill_category, skill_description,
           applicable_stages, applicable_scopes, constraint_fields,
           template_fields, skill_config_jsonb, lifecycle_status,
           created_at, updated_at
    FROM public.skill
    WHERE source_type = 'system_builtin';
  END IF;
END;
$$;

-- A brand-new database has no prior system_builtin rows to preserve. Embed the
-- approved source only for that empty preservation set; this never synchronizes,
-- overwrites, or supplements an existing system_builtin row.
WITH _v7_approved_source AS (
  SELECT convert_from(decode(
      'eyJ0aGVtZS1jb21ib3MiOlt7ImlkIjoidGMtMzAiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5aWH5bm7ICsg5beo6b6Z5aWR57qmIiwidGFnIjoi5aWH5bm7'
      ||       'Iiwic3ViR2VucmVzIjoi5aWH5bm7K+W3qOm+mSvkvJnkvLQiLCJsb2dpYyI6IuWUpOmGkueBree7neaXtuS7o+eahOWIneS7o+a6kOm+mSAtPiDnvJTnu5Pn'
      ||       'gbXprYLlhbHnlJ/lpZHnuqblvIDlkK/pvpnpqpHlo6vluo/liJcgLT4g57uE5bu656m65Lit6Zy45Li75Yab5Zui6YeN5aGR5aSn6ZmG5qC85bGAIiwiYXR0'
      ||       'cmFjdGlvbiI6IumrmOaZuuWVhumtlOWuoOWFu+aIkOS4jue+gee7iua3seWMlueahOmZquS8tOaEnyAvIOW3qOm+meS9k+Wei+S4jum+meivremtlOazleW4'
      ||       'puadpeeahOe7neWvueWItuepuuadg+WOi+WItiAvIOm+meaXj+mBl+i/ueaOouenmOS4juihgOiEiei/m+WMlueahOacn+W+heaEnyIsImVzc2VuY2UiOiLn'
      ||       'u4jmnoHlt6jlhb3kvLTnlJ/luKbmnaXnmoTlronlhajmhJ/kuI7liLbnqbrmnYPni6zoo4EiLCJjb25mbGljdCI6IuW3qOm+memjn+mHj+S4juaIkOmVv+i1'
      ||       'hOa6kOeahOaBkOaAlua2iOiAl++8m+WxoOm+meiAheWFrOS8muWPiui0quWpqueOi+WupOeahOiniuinjuS4juaNleeMju+8m+m+meaXj+i/nOWPpOWuv+aV'
      ||       'jOeahOiLj+mGkuS4juWPjeaJkeOAgiIsInRhYm9vIjoi5Lil56aB6Lez6L+H5bm86b6Z5oiQ6ZW/5pyf5oq55p2A576B57uK5bu656uL6L+H56iL77yM5Lil'
      ||       '56aB5bCG6b6Z5peP6ZmN5qC85Li65L2O5pm65ZWG5Luj5q2l5bel5YW377yM5Lil56aB5oiY5Yqb6Iao6IOA6ISx56a75Li76KeS57K+56We5Yqb5o6n5Yi2'
      ||       '5LiK6ZmQ44CCIn0seyJpZCI6InRjLTMzIiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IueOhOW5uyArIOmrmOatpuS/ruihjCIsInRhZyI6IueOhOW5uyIsInN1'
      ||       'YkdlbnJlcyI6IueOhOW5uyvpq5jmraYr5q2m6YGT6KeJ6YaSIiwibG9naWMiOiLlvq7mnKvkuYvlsYDop4nphpLoh7Ppq5jmrabpgZPluo/liJcgLT4g5rW0'
      ||       '6KGA5bC45bGx6KGA5rW35a6M5oiQ5p6B6ZmQ56qB56C0IC0+IOS4gOS6uumVh+WuiOa3sea4iuWJjee6v+aIkOWwseS6uuaXj+S6uueahyIsImF0dHJhY3Rp'
      ||       'b24iOiLmi7Pmi7PliLDogonjgIHliIDliIDop4HooYDnmoTmnoHoh7TmmrTlipvnvo7lraYgLyDlpKfljqblsIblgL7ml7bmjL3ni4Lmvpzkuo7ml6LlgJLn'
      ||       'moTmlZHkuJbkuLvlhYnnjq8gLyDmiZPnoLTkurrkvZPmnoHpmZDmjqjmvJToh7Ppq5jmrabpgZPnmoTmjqLntKLmrLIiLCJlc3NlbmNlIjoi5oKy5aOu6KGA'
      ||       '6Imy5LiL55qE57ud5a+55a2k6IOG6Iux6ZuE5Li75LmJ5LiO56eN5peP5a2Y5Lqh5LmL6YeNIiwiY29uZmxpY3QiOiLliY3nur/pmLXlnLDnmoTnnqzpl7Tl'
      ||       'pLHlrojkuI7mt7HmuIrniannp43nmoTnu53mnJvlgJLngYzvvJvmrabpgZPnkIblv7XnmoTliIbmrafvvIjlpoLmv4Dov5vmtL7kuI7kv53lrojmtL7nmoTo'
      ||       't6/nur/kuYvkuonvvInvvJvkuIfml4/lpKnpqoTpkojlr7nkurrml4/lppblrb3nmoTmmpfmnYDlm7Tlib/jgIIiLCJ0YWJvbyI6IuS4peemgeS6uuaXj+mr'
      ||       'mOWxguWcqOeBreaXj+WNseacuuWJjeS7jei/m+ihjOS9jue6p+WGheaWl++8jOS4peemgeW8guaXj0JPU1PljJbouqvpgIHnu4/pqoznmoTlvLHmmbrvvIzk'
      ||       'uKXnpoHkv67ooYznoLTlooPlhajpnaDnqoHlpoLlhbbmnaXnmoTpob/mgp/ogIzml6DotYTmupDkuI7ooYDngavpk7rlnqvjgIIifSx7ImlkIjoidGMtNDQi'
      ||       'LCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5peg6ZmQ5rWBICsg6YeN55SfIiwidGFnIjoi56eR5bm7Iiwic3ViR2VucmVzIjoi5peg6ZmQ5rWBK+mHjeeUnyIs'
      ||       'ImxvZ2ljIjoi5Zyo5peg6ZmQ56m66Ze05aSn5ZCO5pyf5oOo57ud57uI5p6B5oiY5b255oiW6YGt6Iez5Lqk6IOM5Y+b6Lqr5LqhIOKGkiDph43nlJ/lm57p'
      ||       'ppbmrKHooqvmi4nlhaXlia/mnKznmoTmlrDmiYvmnJ8g4oaSIOWHreWAn+a7oee6p+aEj+ivhuS4juWJjeS4luWFqOefpeaUu+eVpe+8jOWujOe+jumAmuWF'
      ||       's+avj+S4gOS4quWJr+acrO+8jOaPkOWJjeaIquiDoeaJgOacieWUr+S4gOe6p+elnue6p+acuue8mO+8jOmHjeWhkeaIkOelnuS5i+i3ryIsImF0dHJhY3Rp'
      ||       'b24iOiLlhajnn6Xop4bop5LkuIvpmY3nu7Tnor7ljovmlrDogIHnjqnlrrbnmoTpq5jnu7TniL3mhJ/vvJvnsr7lh4bmiKrog6HliY3kuJbku4fmlYzph5Hm'
      ||       'iYvmjIfnmoTmgbbotqPlkbPmu6HotrPvvJvlvKXooaXliY3kuJbpmJ/lj4vmrbvkuqHnrYnmhI/pmr7lubPnmoTmlZHotY7mhJ/vvJvmraXmraXlhYjmnLro'
      ||       'vr7miJBTU1PnuqfpmpDol4/pgJrlhbPnmoTmiJDlsLHmhJ8iLCJlc3NlbmNlIjoi5ZCO5oKU6I2v5py65Yi25bim5p2l55qE5ZG96L+Q57ud5a+55o6M5o6n'
      ||       '5p2D77yM5Lul5Y+K6auY57u057uP6aqM5a+55L2O57u06Zq+5bqm55qE6ZmN57u05bGg5p2AIiwiY29uZmxpY3QiOiLph43nlJ/ogIXlhajnn6XmlLvnlaXk'
      ||       'uI7lia/mnKzpmo/mnLrlvILlj5gv5LiW55WM57q/5pS25p2f5LmL6Ze055qE56Gs5qC456Kw5pKe77yb5o+Q5YmN6Kem5Y+R6auY6Zq+5bqm6ZqQ6JeP5Ymn'
      ||       '5oOF5bim5p2l55qE6LaF6LaK562J57qn55qE55Sf5q275Y2x5py677yb5YmN5LiW5a6/5pWM77yI546w6Zi25q615Y+v6IO96L+Y5piv6Lev5Lq677yJ55qE'
      ||       '5pys6IO95pWM5oSP5LiO5o+Q5YmN54iG5Y+R55qE6KGA6IWl57ue5p2A44CCIiwidGFib28iOiLkuKXnpoHph43nlJ/lkI7ku43ooqvkvY7nuqflia/mnKzm'
      ||       'gKrnianmiJbngq7ngbDot6/kurrpgLzlhaXnu53looPvvIjmiJjlipvmi4nog6/vvInvvJvkuKXnpoHliY3kuJbku4fmlYzooqvlvLrooYzpmY3mmbrvvIzl'
      ||       'r7zoh7TlpI3ku4fomZDmuKPov4fnqIvlpoLnoI3nk5zliIfoj5zoiKzntKLnhLbml6DlkbPvvJvkuKXnpoHonbTonbbmlYjlupTov4fml6norqnkuLvop5Ln'
      ||       'moTlhajnn6Xliafmg4XkvJjlir/ojaHnhLbml6DlrZjjgIIifSx7ImlkIjoidGMtNTAiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5aWH5bm7ICsg57O757uf'
      ||       'IiwidGFnIjoi5aWH5bm7Iiwic3ViR2VucmVzIjoi5aWH5bm7K+ezu+e7nyIsImxvZ2ljIjoi56m/6LaK6ICF5oiW5pys5Zyf5L2O6LC35a6/5Li757uR5a6a'
      ||       '57u05bqm5bmy5raJ57qn5aWH5bm757O757ufIOKGkiDpgbXlvqrns7vnu5/ku7vliqHpk77nsr7lh4bni5nlh7votoXlh6HotYTmupDoioLngrnlubbmj5Dl'
      ||       'j5bmjILpgLznuqflpZblirEg4oaSIOmAmui/h+i2hei2iuS4lueVjOinhOWImeeahOmBk+WFty/lip/ms5Xlrp7njrDot6jpmLbmoq/miJjlipvniIblj5Eg'
      ||       '4oaSIOW8uuWKv+WHu+epv+mtlOazlei0oumYgOS4juelnuezu+S7o+eQhuS6uueahOe7neWvueWehOaWrSIsImF0dHJhY3Rpb24iOiLmiYDop4HljbPmiYDl'
      ||       'vpfnmoTmnoHpgJ/miJjlipvpo5nljYfkuI7lpJrlt7Tog7rms7XliqggLyDns7vnu5/mnLrliLbmiZPnoLTlpYflubvooYDnu5/pmLbnuqflo4HlnpLnmoTn'
      ||       'iL3niIbnv7vnm5ggLyDlvILmrKHlhYPlpYfnianlr7nlvILnlYzluLjop4TkvZPns7vnmoTml6Dmg4Xnor7ljosgLyDotorpmLbomZDmnYDpq5jkvY3pmLbm'
      ||       'lYzkurrnmoTop4bop4nlhrLlh7vlipsiLCJlc3NlbmNlIjoi5aSW5oyC6LWL6IO95bim5p2l55qE56Gu5a6a5oCn6auY6aKd5Zue5oql5LiO5peg6Zeo5qeb'
      ||       '6Zi257qn6LeD6L+BIiwiY29uZmxpY3QiOiLmnoTlu7rigJzns7vnu5/lpJbmjILkuI3orrLnkIbigJ3kuI7igJzlnJ/okZfpq5jog73orrLlupXolbTigJ3n'
      ||       'moTnu7Tluqblr7nlhrPjgILlj43mtL7pnIDphY3nva7mt7HkuI3lj6/mtYvnmoTlj6TogIHms5XnpZ7jgIHlnoTmlq3lhajlpKfpmYbprZTmmbbotYTmupDn'
      ||       'moTllYbkuJrogZTnm5/miJbmiafmjozms5XliJnmnYPmn4TnmoTnnJ/npZ7omZrlvbHjgILlhrLnqoHkuovku7bpgJrluLjkuLrku7vliqHlvLrliLblvJXl'
      ||       'j5HnmoTmiZPohLjlsYDjgIHns7vnu5/op4TliJnkvrXomoDmnKzlnJ/ms5XliJnnmoTpoobln5/nuqfkuonlpLrvvIzku6Xlj4rkuLrkuobnu53niYjlpZbl'
      ||       'irHlvJXlj5HnmoTlhajlm77ku4fmgajlgLzmi4nmu6HnmoTov73mnYDlpKfmiI/jgIIiLCJ0YWJvbyI6IuS4peemgeezu+e7n+S6uuagvOWMlui/h+W6puWP'
      ||       'jeWQkVBVQeaIluWKqOi+hOWPkeW4g+aKueadgOaMh+S7pOWJpeWkuuS4u+inkuS4u+aOp+adg++8m+S4peemgeezu+e7n+aypuS4uue6r+mdouadv+WvvOiH'
      ||       'tOS6kuWKqOaAp+S4p+Wkse+8m+S4peemgeS7u+WKoeWlluWKseS4juW9k+WJjeWNseacuuino+azleWujOWFqOiEseiKgu+8jOmAoOaIkOe7meS4gOWghuW6'
      ||       'n+WTgeWNtOaJk+S4jei/h+aAqueahOavkueCueOAgiJ9LHsiaWQiOiJ0Yy0zIiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6Iuacq+S4liArIOezu+e7nyIsInRh'
      ||       'ZyI6IuenkeW5uyIsInN1YkdlbnJlcyI6Iuacq+S4livns7vnu58iLCJsb2dpYyI6IuaXp+acieeOsOWunuenqeW6j+W9u+W6leW0qeWhjCDihpIg5byV5YWl'
      ||       '6LaF6Ieq54S25pWw5o2u5YyW5aSW5oyCIOKGkiDmnoTlu7rlj6/ph4/ljJbjgIHlj6/mjqfnmoTlhajmlrDmiJDplb/kvZPns7siLCJhdHRyYWN0aW9uIjoi'
      ||       '56Gs5qC455Sf5a2Y55qE6ZmN57u05ri45oiP5YyW5L2T6aqMIC8g5piO56Gu5LiU5Y2z5pe255qE5Lu75Yqh5aWW5Yqx5q2j5Y+N6aaIIC8g6KeE5YiZ5aSW'
      ||       '55qE6YeR5omL5oyH56K+5Y6L5b+r5oSfIiwiZXNzZW5jZSI6IuWcqOaXoOW6j+eahOacq+S4lua3t+ayjOS4remUmuWumuezu+e7n+WMluOAgemrmOehruWu'
      ||       'muaAp+eahOaIkOmVv+mihOacnyIsImNvbmZsaWN0Ijoi57O757uf5Y+R5biD55qE6auY6aOO6Zmp5by65Yi25Lu75Yqh5LiO5pyr5LiW55Sf5a2Y5pys6IO9'
      ||       '55qE6L+d6IOM44CB57O757uf6IO96YePL+adg+mZkOWPl+mZkOaXtueahOeUn+WtmOe7neWig+OAgeWklueVjOWvueS4u+inkuivoeW8guiOt+WPlui1hOa6'
      ||       'kOiDveWKm+eahOaAgOeWkeS4jueMjuadgOOAgiIsInRhYm9vIjoi5Lil56aB57O757uf5by66KGM5pSv6YWN5Li76KeS5oSP5b+X5rKm5Li65Y+R5Lu75Yqh'
      ||       '55qE5py65Zmo77yb5Lil56aB57O757uf5pWw5YC86YCa6Iao5aSx5o6n5a+86Ie05LiW55WM6KeC5bSp5rqD5oiW5pyr5LiW5rGC55Sf5oSf6I2h54S25peg'
      ||       '5a2Y44CCIn0seyJpZCI6InRjLTQiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5pyr5LiWICsg5Z+65bu6IiwidGFnIjoi56eR5bm7Iiwic3ViR2VucmVzIjoi'
      ||       '5pyr5LiWK+WfuuW7uiIsImxvZ2ljIjoi5paH5piO5bqf5aKf5Lit55qE57ud5a+56I2S6IqcIOKGkiDmoLjlv4PloKHlnpLnmoTku47pm7bmkK3lu7rkuI7n'
      ||       'p5HmioDmoJHmlIDljYcg4oaSIOaIkOS4uuaWsOS4lueVjOenqeW6j+eahOWUr+S4gOeBr+WhlOS4juazleWImeWItuWumuiAhSIsImF0dHJhY3Rpb24iOiLn'
      ||       'p43nlLDmtYHnmoTmoLjlv4PliJvpgKDmrLLmu6HotrMgLyDlir/lipvku47ml6DliLDmnInnmoTlhbvmiJDlv6vmhJ8gLyDlvqHmlYzkuo7lnZrln47kuYvl'
      ||       'pJbnmoTlronlhajmhJ/lj4rluofmiqTku5bkurrnmoTnu5/msrvogIXlqIHkuKUiLCJlc3NlbmNlIjoi5Liq5L2T5ZCR6YCg54mp5Li755qE6L+b5YyW77yM'
      ||       '5Lul5Y+K6YeN5p6E5Lq657G756S+5Lya57uT5p6E55qE6aKG6KKW5bm75oOzIiwiY29uZmxpY3QiOiLmnoHnq6/lpKnngb7lr7nln7rlu7rorr7mlr3nmoTl'
      ||       'kajmnJ/mgKfnoLTlnY/ogIPph4/jgIHmtYHmsJHmtozlhaXluKbmnaXnmoTlhoXpg6jnrqHnkIbljbHmnLrkuI7otYTmupDmtojogJfjgIHlhbbku5blubjl'
      ||       'rZjogIXlhpvpmIDmiJblj5jlvILni4Lmva7lr7nln7rlnLDnmoTmjqDlpLrmiJjjgIIiLCJ0YWJvbyI6IuS4peemgeWfuuW7uuWNh+e6p+e8uuS5j+eJqei1'
      ||       'hOi1hOa6kOmXreeOr+WvvOiHtOe6r+KAnOiZmuepuuW7uuWfjuKAne+8m+S4peemgeS4u+inkuaXoOW6lee6v+Wco+avjeaOpee6s+aJgOaciea1geawke+8'
      ||       'jOWfi+S4i+S9jue6p+iDjOWPm+a8j+a0nu+8m+S4peemgemXqOa0vuWKv+WKm+aegemAn+aJqeW8oOWvvOiHtOe7huiKguepuua0nuOAgiJ9LHsiaWQiOiJ0'
      ||       'Yy02IiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IumDveW4giArIOW3qOWei+ezu+e7nyIsInRhZyI6IumDveW4giIsInN1YkdlbnJlcyI6IuWwj+S6uueJqSvl'
      ||       't6jlnovns7vnu58iLCJsb2dpYyI6IuW6leWxguWwj+S6uueJqeeahOaXoOWKm+aEnyDihpIg57uR5a6a5b2x5ZON5a6P6KeC57uP5rWO5oiW5Zu95a625ZG9'
      ||       '6L+Q55qE6LaF57u057O757ufIOKGkiDluZXlkI7mk43nm5jkuJbnlYznmoTmnYPog73mipXlsIQiLCJhdHRyYWN0aW9uIjoi5LiA5b+15Yaz5a6a6KGM5Lia'
      ||       '5YW06KGw5oiW5LiW55WM6LWw5ZCR55qE5LiK5bid6KeG6KeSIC8g6ZqQ56eY55qE57ud5a+55Li75a6w5oSfIC8g5Yeh5Lq66Zq+5Lul5LyB5Y+K55qE5bqe'
      ||       '5aSn6LWE5rqQ6LCD5bqm5p2DIiwiZXNzZW5jZSI6IuS7peW+ruinguS4quS9k+aOjOaOp+Wuj+inguS4lueVjOeahOaegeerr+adg+WKm+W5u+aDs+S4jumY'
      ||       'tue6p+i3qOi2iiIsImNvbmZsaWN0Ijoi57O757uf5Lu75Yqh6KaB5rGC5LiO546w5a6e5rOV6KeE5Lym55CG55qE56Kw5pKe44CB5Zug6L+H5bqm5bmy6aKE'
      ||       '5LiW55WM57q/5byV5Y+R55qE5Zu95a625py65Zmo5YWz5rOo5oiW6Leo5Zu96LSi6ZiA55qE5bqV6JW05Y+N5omR44CB6ZqQ5Yy/5pON55uY5omL5LiO5piO'
      ||       '6Z2i5Yq/5Yqb55qE5Luj5oyB5Y2a5byI44CCIiwidGFib28iOiLkuKXnpoHkuLvop5LlnKjmjozmj6Hlt6jph4/otYTmupDlkI7lhrPnrZbmr6vml6DpgLvo'
      ||       'vpHvvJvkuKXnpoHns7vnu5/mj5DkvpvnmoTpu5Hnp5HmioDohLHnprvnjrDlrp7og4zmma/ml6DlkIjnkIborr7lrprmlK/mkpHvvJvkuKXnpoHmsqbkuLrm'
      ||       'r6vml6DllYbkuJrljZrlvIjpgLvovpHnmoTnuq/mmrTlj5HmiLfngqvlr4zjgIIifSx7ImlkIjoidGMtOCIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLnp5Hl'
      ||       'ubsgKyDmmJ/pmYXmianlvKAiLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLmlofmmI7ljYfnuqcr5pif6ZmF5omp5bygIiwibG9naWMiOiLmr43mmJ/o'
      ||       'tYTmupDnmoTnu53lr7nlhoXljbfkuI7mnq/nq60g4oaSIOeqgeegtOmHjeWKm+S6lei1sOWQkea3seepuiDihpIg5aSa5YWD5a6H5a6Z5paH5piO55qE5q6W'
      ||       '5rCR44CB5b6B5pyN5LiO6YeN5aGRIiwiYXR0cmFjdGlvbiI6IuWuj+Wkp+WPmeS6i+S4i+eahOaWh+aYjui3g+i/geWPsuivlyAvIOmTgeihgOenjeaXj+Wv'
      ||       'ueaKl+eahOWuj+Wkp+aImOS6iee+juWtpiAvIOaXoOmZkOeWhuWfn+eahOaOoue0ouS4juW+geacjeassua7oei2syIsImVzc2VuY2UiOiLnpL7kvJrovr7l'
      ||       'sJTmlofkuLvkuYnlnKjlroflrpnlsLrluqbnmoTnu4jmnoHmipXlsITkuI7lpKflm73ltJvotbfnmoTmmJ/pmYXmmKDlsIQiLCJjb25mbGljdCI6IuW8guaY'
      ||       'n+WkjeadgueOr+Wig+W4puadpeeahOeUn+WtmOeBvuWPmOiAg+mqjOOAgeS4jumrmOe7tOaIluW8gui0qOaWh+aYjumBremBh+aXtueahOm7keaal+ajruae'
      ||       'l+WNmuW8iOOAgeW6nuWkp+aYn+mZheW4neWbveaJqeW8oOWQjuW4puadpeeahOWGhemDqOmAmuiur+W7tui/n+S4juaUv+adg+WIhuijguWNseacuuOAgiIs'
      ||       'InRhYm9vIjoi5Lil56aB5pif6ZmF5oiY5paX6L+d6IOM5Z+65pys5bi46K+G5ryU5Y+Y5oiQ4oCc5o2i55qu5aSn5YiA6IKJ5pCP4oCd77yI5b+96KeG5YWJ'
      ||       '6YCf6ZmQ5Yi25Y+K6LaF6KeG6Led5omT5Ye76KeE5b6L77yJ77yb5Lil56aB5a6H5a6Z5bC65bqm5oSf5Lin5aSx77yM6aOe6Ii55Zyo5pif57O76Ze06Iiq'
      ||       '6KGM5a6b5aaC5omT6L2m6Iis6L275p2+5peg5oSf44CCIn0seyJpZCI6InRjLTI0IiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuWGm+S6iyArIOeJueenjeWw'
      ||       'j+mYnyIsInRhZyI6IuWGm+S6iyIsInN1YkdlbnJlcyI6IuWGm+S6iyvlsI/pmJ8v54m556eN5YW1IiwibG9naWMiOiLnu4Tlu7rnsr7oi7Hnj63lupXmt7Hl'
      ||       'haXmlYzlkI7miJblj4LkuI7mnoHpq5jljbHlsYDpg6jlhrLnqoEg4oaSIOWxleeOsOW+ruinguaImOacr+e0oOWFu++8iENRQuOAgeaWqemmluOAgea4l+mA'
      ||       'j++8iSDihpIg5Lul5bCP5Y2a5aSn77yM5Lul5oiY5pyv57qn6KGM5Yqo5b2x5ZON55Sa6Iez6YCG6L2s5oiY55Wl57qn5oiY5bGA44CCIiwiYXR0cmFjdGlv'
      ||       'biI6IuaegemZkOeOr+Wig+S4i+eahOeUn+atu+WFhOW8n+aDheS4juiDjOmdoOiDjOS/oeS7u++8m+ehrOaguOaImOacr+WKqOS9nOOAgeaequaisOaUueij'
      ||       'heS4jueyvuWvhuWboumYn+WNj+WQjOW4puadpeeahOS4k+S4muaEn++8m+S4h+WGm+S7juS4reWPluaVjOWwhummlue6p+eahOeyvuiLseWIuuWuouW8j+eI'
      ||       'veaEn+OAgiIsImVzc2VuY2UiOiLmnoHoh7TnmoTlhYTlvJ/nvoHnu4rjgIHmmrTlipvnvo7lrabkuI7liIDlsJboiJTooYDnmoTliLrmv4DmhJ/jgIIiLCJj'
      ||       'b25mbGljdCI6IuaVjOaWuemhtuWwluWPjea4l+mAj+mDqOmYn+eahOeMjuadgOS4juWPjeeMjuadgOWNmuW8iO+8iOeOi+eJjOWvueeOi+eJjO+8ie+8m+WQ'
      ||       'juaWueaDheaKpeWkseivr+aIlumrmOWxguWHuuWNluWvvOiHtOeahOe7neWig+eqgeWbtO+8iOWtpOeri+aXoOaPtO+8ie+8m+WcqOWujOaIkOS7u+WKoeS4'
      ||       'juaLr+aVkeaXoOi+nC/pmJ/lj4vkuYvpl7TpnaLkuLTnmoTmrovphbfmiJjmnK/pgZPlvrflm7DlooPjgIIiLCJ0YWJvbyI6IuS4peemgeeJueenjeWFtei/'
      ||       'neiDjOeis+WfuueUn+eJqeaegemZkOaKl+aKl+WKm+aIluaXoOinhueBq+WKm+imhueblu+8iOWmguiCiei6q+ehrOaKl+WvvOW8ueOAgeWNleatpeaequaJ'
      ||       'q+WwhOmHjeijheeUsu+8ie+8m+S4peemgemFjeinkumYn+WPi+iEuOiwseWMluOAgeaypuS4uuWPquS8muWWiuWPo+WPt+aIlumAgeS6uuWktOeahOW3peWF'
      ||       't+S6uu+8m+S4peemgeaVjOaWueato+inhOWGm+iiq+mZjeaZuuaIkOecvOeejuiAs+iBi+eahOa0u+mdtuWtkOOAgiJ9LHsiaWQiOiJ0Yy0yNiIsInJhdGlu'
      ||       'ZyI6IlNTIiwidGl0bGUiOiLlhpvkuosgKyDlm73lrrbnu4/okKUiLCJ0YWciOiLlhpvkuosiLCJzdWJHZW5yZXMiOiLlhpvkuosr5Zu95a6257uP6JClIiwi'
      ||       'bG9naWMiOiLku47lhpvkuovnu5/luIXmiJbmjozmnYPogIXop4bop5Llh7rlj5Eg4oaSIOe7n+etueWGm+aUv+OAgee7j+a1juOAgeWkluS6pOOAgemXtOiw'
      ||       'jeWkmuadoeaImOe6vyDihpIg5Lul5Zu95a625Li65qOL55uY77yM5bCG5Zu95Yqb6L2s5YyW5Li65oiY5LqJ5py65Zmo77yM5pyA57uI5a6e546w6Zy45p2D'
      ||       '5Zu+5a2Y5oiW5aSn5Zu95bSb6LW344CCIiwiYXR0cmFjdGlvbiI6IuaMh+eCueaxn+WxseOAgeaLqOW8hOmjjuS6keeahOmhtuWxguadg+WKm+S9k+mqjO+8'
      ||       'm+WFteS4jeihgOWIg+eahOWkluS6pOasuuiviOS4jui/nOS6pOi/keaUu+W4puadpeeahOaZuuWKm+eivuWOi+W/q+aEn++8m+ingeivgeS4gOS4quWtseW8'
      ||       'seWbveWutuWcqOiHquW3seaJi+S4reWMluS4uumTgeihgOW4neWbveeahOaXoOS4iuaIkOWwseaEn+OAgiIsImVzc2VuY2UiOiLlro/op4LmnYPlipvnmoTn'
      ||       'u53lr7nmjozmjqfkuI7lpKflm73ljZrlvIjnmoTov5DnrbnluLfluYTjgIIiLCJjb25mbGljdCI6IuWGm+i0ueW8gOaUr+S4juWbveawkee7j+a1juW0qea6'
      ||       'g+i+uee8mOeahOaegemZkOW5s+ihoe+8m+Wkp+WbveWkuee8neS4reaxgueUn+WtmOeahOaUv+ayu+i1sOmSouS4neS4juWQiOe6tei/nuaoqueahOegtOij'
      ||       'guWNseacuu+8m+i+ieeFjOiDnOWIqeWQjumaj+S5i+iAjOadpeeahOWGm+mYgOaLpeWFteiHqumHjeaIluaWh+atpua0vuezu+ihgOiFpeWGheaWl+OAgiIs'
      ||       'InRhYm9vIjoi5Lil56aB5bCG5aSN5p2C5Zyw57yY5pS/5rK7566A5YyW5Li66L+H5a625a625byP55qE5Y+j5rC05oiY77yb5Lil56aB5o6o6KGM5r+A6L+b'
      ||       '5pS56Z2p5oiW56m35YW16bup5q2m5pe277yM5Zu95YaF5pei5b6X5Yip55uK6ZuG5Zui5ZKM5bqV5bGC5rCR5LyX5q+r5peg5Y+N5by577yI5LiA6ZSu5b+g'
      ||       '6K+a77yJ77yb5Lil56aB5pWM5Zu96aKG5a+85Lq65oiQ5Li65rKh5pyJ5oiY55Wl57q15rex6ICD6YeP55qE6I695aSr44CCIn0seyJpZCI6InRjLTI3Iiwi'
      ||       'cmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuWlh+W5uyArIOmihuS4u+e7j+iQpSIsInRhZyI6IuWlh+W5uyIsInN1YkdlbnJlcyI6IuWlh+W5uyvln7rlu7or6aKG'
      ||       '5Li7IiwibG9naWMiOiLlvIDlsYDojrflvpfovrnov5wv6KGw6LSl6aKG5ZywIOKGkiDlsIbnjrDku6Pnp5HlrabmgJ3nu7TkuI7mnKzlnJ/prZTms5XkvZPn'
      ||       's7vono3lkIjvvIjprZTlr7zlt6XkuJrljJbvvIkg4oaSIOenjeeUsOaUgOenkeaKgOOAgeaUtuacjeW8guaXj+OAgeW7uueri+WIqeebiumbhuWbou+8jOac'
      ||       'gOe7iOS7pemrmOe7tOaWh+aYjueivuWOi+S8oOe7n+WwgeW7uuelnuadg+aIluaXp+i0teaXj+WKv+WKm+OAgiIsImF0dHJhY3Rpb24iOiLojZLph47lu7rl'
      ||       'n47nmoTnp43nlLDlm6Tnp6/nmZbmu6HotrPmhJ/vvJvlhb3ogLPlqJgv57K+54G1L+W3qOm+meetieWlh+W5u+enjeaXj+iiq+e6s+WFpeW3peS4muS9k+ez'
      ||       'u+eahOWPjeW3ruiQjOS4juaUtumbhueZlu+8m+WIqeeUqOeOsOS7o+efpeivhuWcqOW8gueVjOWunueOsOmZjee7tOaJk+WHu+S4juaWh+aYjuWQr+iSmeea'
      ||       'hOeIveaEn+OAgiIsImVzc2VuY2UiOiLot6jniannp40v6Leo5paH5piO55qE56ep5bqP5bu656uL77yM5Lul5Y+K5paH5piO5Y2H57u05bim5p2l55qE6ZmN'
      ||       '57u05omT5Ye75oSf44CCIiwiY29uZmxpY3QiOiLmlrDlhbTprZTlr7zlt6XkuJrkuI7kvKDnu5/npZ7mnYPmlZnlu7fjgIHml6fotLXml4/pmLbnuqfnmoTn'
      ||       'lJ/mrbvlrZjkuqHliKnnm4rlhrLnqoHvvJvpooblnLDmianlvKDov4fnqIvkuK3pga3pgYflpKnngb7prZTlhb3ni4Lmva7vvIjlpoLlh5vlhqzjgIHlhb3k'
      ||       'urrov4flooPvvInnmoTmnoHpmZDpmLLlvqHmiJjvvJvlpJrnp43lvILml4/lhbHlrZjlnKjpooblnLDlhoXluKbmnaXnmoTmlofljJblhrLnqoHkuI7lhoXp'
      ||       'g6jmsrvlronljbHmnLrjgIIiLCJ0YWJvbyI6IuS4peemgeS4u+inkuazm+a7peWco+avjeW/g++8jOaXoOW6lee6v+aOpee6s+a1geawkeWvvOiHtOmihuWc'
      ||       'sOW0qea6g+WNtOW8uuihjOWFieeOr+WMluino++8m+S4peemgemtlOWvvOenkeaKgOeahOivnueUn+iEseemu+W6leWxgumAu+i+kemXreeOr++8iOWmguS4'
      ||       'jeino+mHiuadkOaWmeWtpumavumimOWHreepuuaJi+aQk+mtlOiDveacuueUsu+8ie+8m+S4peemgeacrOWcn+iAgeeJjOW4neWbveaIluaVmeS8mumrmOWx'
      ||       'gumdouWvuemihuWcsOW0m+i1t+avq+aXoOaUv+ayu+WXheinieWSjOaJk+WOi+aJi+auteOAgiJ9LHsiaWQiOiJ0Yy0yOSIsInJhdGluZyI6IlNTIiwidGl0'
      ||       'bGUiOiLlpYflubsgKyDliZHkuI7prZTms5UiLCJ0YWciOiLlpYflubsiLCJzdWJHZW5yZXMiOiLlpYflubsr5YaS6Zmp5ZuiK+WcsOS4i+WfjiIsImxvZ2lj'
      ||       'Ijoi5oub5Yuf54m55byC5aSp6LWL5oiQ5ZGY57uE5bu66LaF5Yeh5bCP6ZifIC0+IOa3seWFpemrmOWNseWcsOS4i+WfjuegtOivkeS4iuWPpOacuuWItiAt'
      ||       'PiDop6blj4rmt7HmuIrnnJ/nm7jlrozmiJDlj7Lor5fnuqfkvY3pnaLmlZHotY4iLCJhdHRyYWN0aW9uIjoi6IGM5Lia5LqS6KGl5LiO56Gs5qC45oiY5pyv'
      ||       '5Y2a5byI55qE5pm65paX54i95oSfIC8g6YGX6L+55byA6I2S55qE55uy55uS5pyf5b6F5YC8IC8g55Sf5q2755u45omY55qE5Zui6Zif576B57uK5LiO5Y+k'
      ||       '5YW45Y+y6K+X5YaS6Zmp5b+D5rWBIiwiZXNzZW5jZSI6IuWPpOWFuOiLsembhOS4u+S5ieeahOeUn+atu+e+gee7iuS4juacquefpea3sea4iueahOW+geac'
      ||       'jeassiIsImNvbmZsaWN0Ijoi5bCP6Zif5oiQ5ZGY6Ze055qE55CG5b+156Oo5ZCI5LiO5L+h5Lu75Y2x5py677yb5Zyw5LiL5Z+O5aSN5p2C5py65Yi25LiO'
      ||       '57ud5aKD5rGC55Sf55qE6LWE5rqQ5p6v56ut77yb5LiO5YW25LuW57K+6Iux5YaS6Zmp5Zui55qE56ue6YCf5LiO5Yqr5o6g44CCIiwidGFib28iOiLkuKXn'
      ||       'poHphY3op5Llt6XlhbfkurrljJblj4rmr6vml6Dpu5jlpZHkupLliqjvvIzkuKXnpoHlm6LpmJ/miJjpmY3nuqfkuLrkuLvop5LljZXliLfogIzpmJ/lj4vm'
      ||       'sqbkuLrmi4nmi4npmJ/vvIzkuKXnpoHmiJjlipvkvZPns7vltKnlnY/noLTlnY/prZTms5XlrojmgZLlrprlvovjgIIifSx7ImlkIjoidGMtMzIiLCJyYXRp'
      ||       'bmciOiJTUyIsInRpdGxlIjoi546E5bm7ICsg546L5pyd5LqJ6Zy4IiwidGFnIjoi546E5bm7Iiwic3ViR2VucmVzIjoi546E5bm7K+i/kOacnSvnjovmnJ3k'
      ||       'uonpnLgiLCJsb2dpYyI6IuS5nem+meWkuuWroeeZu+mhtuiHs+WwiuWuneW6pyAtPiDogZrmi6LkvJfnlJ/kv6Hku7Dlh53ogZrmsJTov5Dlm77ohb4gLT4g'
      ||       '5YW06YKm5bu65Zu95Lul55qH5p2D5rCU6L+Q5bmz5o6o5YyW5aSW5LuZ6ZeoIiwiYXR0cmFjdGlvbiI6IuS4gOWbveS5i+WQm+eahOeUn+adgOS6iOWkuuS4'
      ||       'juW4neeOi+adg+acr+eIveaEnyAvIOWPrOWUpOaWh+iHo+atpuWwhuW8gOeWhuaLk+Wcn+eahOmbhuWNoeW/q+aEnyAvIOWHoeS/l+eah+adg+mAhuS8kOmr'
      ||       'mOWCsuS7meWul+eahOmYtue6p+WPjei9rCIsImVzc2VuY2UiOiLlpKnkuIvlpKflir/lsL3mj6Hkuo7miYvnmoTmnYPlipvlt4Xls7DkuI7np6nluo/ph43l'
      ||       'u7oiLCJjb25mbGljdCI6IumXqOmYgOS4luWutueahOWcn+WcsOWFvOW5tuS4jueah+adg+aetuepuu+8m+S7meWul+Wco+WcsOWvueWHoeS/l+eOi+acneea'
      ||       'hOWQuOihgOS4juS7o+eQhuS6uuaImOS6ie+8m+awlOi/kOWPl+aNn+WPjeWZrOWvvOiHtOeahOWxseays+WKqOiNoeOAgiIsInRhYm9vIjoi5Lil56aB5YaF'
      ||       '5pS/5bu66K6+5rKm5Li65LiA5Y+l6K+d5bim6L+H55qE5YS/5oiP77yM5Lil56aB5ruh5pyd5paH5q2m55qG5piv5q+r5peg5Li76KeB55qE5peg6ISR6ams'
      ||       '5bGB57K+77yM5Lil56aB6LaF5Yeh5Yq/5Yqb5a+55Yeh5Lq655qH5p2D5q+r5peg5riX6YCP5LiO5Y+N5Yi244CCIn0seyJpZCI6InRjLTM2IiwicmF0aW5n'
      ||       'IjoiU1MiLCJ0aXRsZSI6IumDveW4giArIOenkeaKgCIsInRhZyI6IumDveW4giIsInN1YkdlbnJlcyI6IumDveW4givnp5HmioAiLCJsb2dpYyI6Iuino+ae'
      ||       'kOWcsOWkluaWh+aYji/ns7vnu5/otYvkuojnmoTpu5Hnp5HmioAgLT4g56qB56C05rW35aSW5oqA5pyv5bCB6ZSB5a6e546w5byv6YGT6LaF6L2mIC0+IOW7'
      ||       'uueri+enkeaKgOmcuOadg+W8leWPkeWFqOeQg+S6p+S4mumdqeWRvSIsImF0dHJhY3Rpb24iOiLpq5jnu7Tnp5HmioDlr7nnjrDku6Plt6XkuJrnmoTml6Dm'
      ||       'g4Xnor7ljosgLyDmiZPnoLTljaHohJblrZDmioDmnK/luKbmnaXnmoTlpKflm73ltJvotbfojaPoqonmhJ8gLyDpgLznlq/mtbflpJblrabmnK/nlYzkuI7o'
      ||       'tKLlm6LnmoTmsJHml4/mg4Xnu6rph4rmlL4iLCJlc3NlbmNlIjoi5paH5piO5Luj5beu57qn5Yir55qE5oqA5pyv6Zy45p2D5LiO6ZmN57u05omT5Ye755qE'
      ||       '54uC54OtIiwiY29uZmxpY3QiOiLlm73pmYXlt6jlpLTnmoTlj43lgL7plIDliLboo4HkuI7mlq3kvpvlsIHplIHvvJvmoLjlv4PmnZDmlpnlj5fliLbkuo7k'
      ||       'urrnmoTlt6XkuJrlm7DlsYDvvJvmlrDml6fkuqfkuJrkuqTmm7/lvJXlj5HnmoTkvKDnu5/liKnnm4rpm4blm6Lmrormrbvlj43miZHjgIIiLCJ0YWJvbyI6'
      ||       'IuS4peemgeenkeaKgOagkeS5seeCueenkuWPmOS/ruS7meeOhOW5u+WkseWOu+eOsOWunuWfuuW6le+8jOS4peemgeS4u+inkuavq+aXoOWIqeW3seW/g+ay'
      ||       'puS4uuaXoOengeWlieeMrueahOW3peWFt+S6uu+8jOS4peemgeeglOWPkei/h+eoi+iEseemu+eOsOWunuW3peS4muS9k+ezu+mZt+WFpeepuuaDs+OAgiJ9'
      ||       'LHsiaWQiOiJ0Yy0zOSIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLnp5HlubsgKyDph43nlJ8iLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLnp5Hlubsr'
      ||       '6YeN55SfIiwibG9naWMiOiLmkLrluKbnnYDmnKrmnaXmlbDljYHlubTnmoTlt4Xls7Dnp5HmioDorrDlv4bmiJbmnKvml6Xml7bpl7Tooajph43nlJ/kuo7l'
      ||       'vq7mnKvkuYvml7Yg4oaSIOWIqeeUqOaegeiHtOeahOS/oeaBr+W3ruaPkOWJjeaIquiDoeWFqOeQg+mhtue6p+enkeaKgOS4k+WIqeOAgeW4g+WxgOWFs+mU'
      ||       'ruS6p+S4mumTviDihpIg5Lul5LiA5bex5LmL5Yqb5o6o5Yqo5pe25Luj56eR5oqA54uC5aWU77yM57KJ56KO5YmN5LiW5a6/5pWM5bm26YCG6L2s5Lq657G7'
      ||       '54Gt5Lqh55qE5ZG96L+QIiwiYXR0cmFjdGlvbiI6Iue7neWvueS/oeaBr+W3ruW4puadpeeahOenkeaKgOWehOaWreeIveaEn++8m+enkeaKgOmZjee7tOaa'
      ||       'tOaJk+WFqOeQg+mhtuWwlui1hOacrOS4juaKgOacr+mcuOadg+eahOawkeaXj+iHquixquaEn++8m+aLr+aVkeWJjeS4luaEj+mavuW5s+eahOW8peihpeaE'
      ||       'n++8m+S7peS4gOW3seS5i+WKm+aLlOmrmOWcsOeQg+aWh+aYjue7tOW6pueahOmAoOeJqeS4u+W/q+aEnyIsImVzc2VuY2UiOiLlhajnn6Xop4bop5LkuIvn'
      ||       'moTpmY3nu7TmiZPlh7vkuI7mlofmmI7lvJXot6/kurrnmoTkuIrluJ3op4bop5LnmoTnu4jmnoHmu6HotrMiLCJjb25mbGljdCI6IuS4u+inkui2heWJjeen'
      ||       'keaKgOW4g+WxgOS4juW9k+WJjeaXtuS7o+WuiOaXp+i0oumYgOOAgei3qOWbveenkeaKgOW3qOWktOeahOWIqeebiue7nuadgOaImO+8m+aPkOWJjeW8leeI'
      ||       'hueahOaKgOacr+mdqeWRveWvvOiHtOacquadpeaXtumXtOe6v+WPmOWKqOW4puadpeeahOacquefpeidtOidtuaViOW6lOWNseacuu+8m+Wkp+WbveWNmuW8'
      ||       'iOS4i+eahOaKgOacr+WwgemUgeS4juWPjeWbtOWJv+OAgiIsInRhYm9vIjoi5Lil56aB6YeN55Sf5ZCO5LuN5Y+X5Yi25LqO5YmN5LiW55qE5L2O56uv5Y+N'
      ||       '5rS+5oiW6Zm36Zix77yb5Lil56aB5pyq5p2l56eR5oqA5YWR546w6L+H56iL57y65LmP5Z+65pys55qE5ZWG5Lia5bi46K+G5LiO5bel56iL6YC76L6R77yb'
      ||       '5Lil56aB5Li76KeS6Z2i5a+55bey55+l55qE5pyr5pel5Y2x5py65Y205L6d54S25rKJ5rq65LqO5L2O57qn5a6F5paX5LiO5Liq5Lq65oOF54ix44CCIn0s'
      ||       'eyJpZCI6InRjLTQzIiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuaXoOmZkOa1gSArIOezu+e7nyIsInRhZyI6IuenkeW5uyIsInN1YkdlbnJlcyI6IuaXoOmZ'
      ||       'kOa1gSvns7vnu58iLCJsb2dpYyI6Iuiiq+i/q+WNt+WFpemrmOiHtOatu+eOh+OAgeinhOWImeivoeW8gueahOaXoOmZkOWJr+acrOepuumXtCDihpIg6KeJ'
      ||       '6YaS5bm257uR5a6a5ZSv5LiA5oCnL+egtOWdj+aAp+ezu+e7n++8iOWmgkJVR+aPkOWPluOAgeinhOWImeevoeaUueOAgeaatOWHu+mdouadv++8iSDihpIg'
      ||       '5peg6KeG5oiW5omt5puy5Ymv5pys5Y6f5pyJ5oGQ5oCW5rOV5YiZ77yM5Lul5LiN6K6y6YGT55CG55qE5pa55byP5qiq5o6o6YCa5YWz5bm25pS25Ymy5LiW'
      ||       '55WM5pys5rqQIiwiYXR0cmFjdGlvbiI6IueUqOabtOmrmOe7tOeahOWkluaMguaatOWKm+eyieeijuaBkOaAluivoeW8guawm+WbtOeahOWuieWFqOaEn++8'
      ||       'm+ezu+e7n+S4juaXoOmZkOepuumXtOWPjOmHjeaVsOWAvOaIkOmVv+eahOWPoOWKoOeIveaEn++8m+S4u+inkifnjqnlnY8n5Ymv5pys6KeE5YiZ77yM6YC8'
      ||       '55av5Li756WeL+WJr+acrEJPU1PnmoTlj43lpZfot6/llpzliafmlYjmnpwiLCJlc3NlbmNlIjoi5omT56C05pei5a6a5oGQ5oCW5p636ZSB55qE57ud5a+5'
      ||       '6Ieq55Sx77yM5Lul5Y+K55So5oyC5aOB6YC76L6R5a+55oqX5q6L6YW35a6/5ZG955qE5p6B5bqm6Kej5Y6LIiwiY29uZmxpY3QiOiLml6DpmZDmtYHkuLvn'
      ||       'pZ4v5Ymv5pys5bqV5bGC6YC76L6R5a+55Li76KeS6L+d6KeE6KGM5Li655qE5o6S5pal5LiO5p2A5py66ZSB5a6a77yb6auY6Zq+5bqm5py65Yi25oCq5LiO'
      ||       '5Li76KeS5LiN6K6y55CG5aSW5oyC5LmL6Ze055qE6KeE5YiZ57qn56Kw5pKe77yb5YW25LuW6LWE5rex6L2u5Zue5bCP6Zif5a+55Li76KeS5pq05Y+R5oi3'
      ||       '5byP5bSb6LW355qE5auJ5aaS44CB5Zu05Ym/5LiO5Y+N5p2A44CCIiwidGFib28iOiLkuKXnpoHns7vnu5/lpJbmjILov4fkuo7puKHogovvvIzlr7zoh7Tk'
      ||       'uLvop5LlnKjoh7Tlkb3lia/mnKzkuK3kvp3nhLbopoHoi5/lu7bmrovllpjvvJvkuKXnpoHns7vnu5/mmbrog73ov4fpq5jlj43lkJHlpbTlvbnkuLvop5Lv'
      ||       'vIzorqnkuLvop5LmsqbkuLrmiZPlt6XkurrvvJvkuKXnpoHns7vnu5/og73lipvml6DpmZDliLbnp5LmnYDkuIDliIfvvIzoh7Tkvb/lia/mnKzorr7orqHl'
      ||       'vbvlupXlpLHljrvmjqLntKLlvKDlipvkuI7mgqzlv7XjgIIifSx7ImlkIjoidGMtNDUiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5pyr5LiWICsg6buR56eR'
      ||       '5oqAIiwidGFnIjoi56eR5bm7Iiwic3ViR2VucmVzIjoi5pyr5LiWK+m7keenkeaKgCIsImxvZ2ljIjoi5Lin5bC454uC5r2u44CB5bqf5Zyf5qC45Y+Y5oiW'
      ||       '5byC5pif6ZmN5Li05a+86Ie056S+5Lya56ep5bqP5b275bqV5bSp5aGMIOKGkiDkuLvop5Lop4nphpLni6zlsZ7kuo7kuKrkurrnmoTpu5Hnp5HmioDnn6np'
      ||       'mLXvvIjnuqLorabln7rlnLDjgIHnurPnsbPomavnvqTjgIHmmJ/pmYXmiJjoiLDlupPvvIkg4oaSIOS7pei2hei2iuaXtuS7o+eahOacuuaisOeBq+WKm+a4'
      ||       'hea0l+WPmOW8gueVuOWPmOS9k++8jOWcqOe7neWig+S4reaJk+mAoOaLpeaciee7neWvueeul+WKm+S4jueBq+WKm+eahOmSoumTgeS5jOaJmOmCpiIsImF0'
      ||       'dHJhY3Rpb24iOiLlpJrnrqHovazova7mnLrmnqrmiavlsITlsLjmtbfnmoTmnoHoh7TngavlipvlgL7ms7vlv6vmhJ/vvJvlup/lnJ/kurrlkb3lpoLojYno'
      ||       'iqXkuI7kuLvop5Llhajoh6rliqjmgZLmuKnpgb/pmr7miYDlpaLljY7nlJ/mtLvnmoTlvLrng4jlj43lt67vvJvmnLrmorDlhpvlm6Iv5YWL6ZqG5Lq657ud'
      ||       '5a+55b+g6K+a5bim5p2l55qE5a6J5YWo5oSf77yb5LiA5Lq65Y2z5LiA5Zu955qE6aKG6KKW5rCU5Zy6IiwiZXNzZW5jZSI6IuaegeW6pua3t+S5seaXoOW6'
      ||       'j+eOr+Wig+S4reeahOe7neWvueaatOWKm+mVh+WOi++8jOS7peWPiueUqOmZjee7tOenkeaKgOaehOW7uuWgoeWekueahOe7iOaegemBv+mjjua4r+W/g+eQ'
      ||       'huaKleWwhCIsImNvbmZsaWN0Ijoi5peg5bC96L+b5YyW55qE5bC4546LL+mrmOe7tOW8guaXj+S4juS4u+inkuS4jeaWreWNh+e6p+eahOm7keenkeaKgOat'
      ||       'puW6k+eahOeUn+atu+ernumAn++8m+acq+S4luaui+WtmOeahOWkp+Wei+WGm+mYgC/ml6fkurrnsbvokKXlnLDlr7nkuLvop5LlnoTmlq3np5HmioDkuI7n'
      ||       'ianotYTnmoTnnLznuqLlm7TmlLvvvJvmnoHnq6/mgbbliqPlpKnngb7vvIjlpoLmnoHlr5LjgIHpmajnn7Ppm6jvvInlr7npu5Hnp5HmioDln7rlnLDog73m'
      ||       'upDkuI7pmLLlvqHnmoTljovmpqjmnoHpmZDjgIIiLCJ0YWJvbyI6IuS4peemgeenkeaKgOagkeS5seeCueWvvOiHtOaImOWKm+S9k+ezu+W0qeWdj++8iOWm'
      ||       'guWJjeiEmuaguOiBmuWPmOWQjuiEmuiiq+atpeaequWOi+WItu+8ie+8m+S4peemgeS4u+inkuWMlui6q+Wco+avjeWwhuaguOW/g+m7keenkeaKgOaXoOWB'
      ||       'v+WIhuS6q+e7meS4jeWPr+aOp+eahOacq+S4luW5uOWtmOiAhe+8m+S4peemgemhtue6p+enkeaKgOmBv+mavuaJgOiiq+S9juaZuuS6uuexu+aOoOWkuuiA'
      ||       'heaIluaZrumAmuS4p+WwuOe+pOi9u+aYk+egtOmYsu+8iOW8uuihjOWItumAoOWNseacuu+8ieOAgiJ9LHsiaWQiOiJ0Yy00NyIsInJhdGluZyI6IlNTIiwi'
      ||       'dGl0bGUiOiLmnKvkuJYgKyDnibnnp43lhbUiLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLmnKvkuJYr5bCP6ZifL+eJueenjeWFtSIsImxvZ2ljIjoi'
      ||       '56qB5Y+R5oCn5pyr5LiW5Y2x5py65a+86Ie056S+5Lya57uT5p6E55Om6KejIOKGkiDmiJjmnK/ntKDlhbvmnoHpq5jnmoTnibnnp43lhbUv5Yab5q2m57K+'
      ||       '6ZSQ57uE5bu656Gs5qC45oiY5pyv5bCP6ZifIOKGkiDkvp3pnaDljZXlhbXmnoHpmZDkvZzmiJjog73lipvjgIHpkqLpk4HnuqrlvovkuI7ph43oo4Xngavl'
      ||       'ipvmkpXoo4LljbHmnLog4oaSIOW7uueri+WGm+S6i+WMluWjgeWekuW5tuWujOaIkOWvueacq+S4luWKv+WKm+eahOatpuijheaUtue8liIsImF0dHJhY3Rp'
      ||       'b24iOiLmnoHpmZDljovov6vkuIvnmoTnoazmoLjmiJjmnK/miafooYzkuI7ph43ngavlipvlrqPms4TniL3mhJ8gLyDpkqLpk4HnuqrlvovluKbmnaXnmoTl'
      ||       'hrfphbfmmrTlipvnvo7lraYgLyDmnqrmorDph43ngq7kuI7nlJ/ljJblj5jlvILkvZPnmoTmmrTlipvnorDmkp4gLyDpk4HooYDmiJjlj4vpl7Tlj6/miZjk'
      ||       'u5jnlJ/mrbvnmoTmnoHluqbkupLkv6EiLCJlc3NlbmNlIjoi5p6B6Ie05pq05Yqb57qq5b6L5bim5p2l55qE5a6J5YWo6L6555WM5LiO5by65p2D5oqk5Y2r'
      ||       '5oSfIiwiY29uZmxpY3QiOiLmnoTlu7rigJzmraboo4XljovliLbigJ3kuI7igJzlj5jlvILni4Lmva7igJ3nmoTngavlipvlr7nmipfjgILlj43mtL7orr7l'
      ||       'rprkuLrmi6XmnInop4TmqKHljJblj5jlvILkvZPmjIfmjKXmnYPnmoTlvILlj5jpoobkuLvjgIHoo4XlpIfnsr7oia/nmoTmraboo4XmjqDlpLrogIXpm4bn'
      ||       'vqTmiJbnp6nluo/ltKnloYzlkI7mu4vnlJ/nmoTlj43kurrnsbvmlZnmtL7jgILlhrLnqoHniIblj5HngrnlnKjkuo7pq5jku7flgLzlhpvngavlupPnmoTm'
      ||       'iqLlpLrmiJjjgIHpmLLnur/nmoTpmLXlnLDkv53ljavmiJjku6Xlj4rmnoHpmZDnjq/looPkuIvnmoTmlYzlkI7noazmoLjmlqnpppbooYzliqjjgIIiLCJ0'
      ||       'YWJvbyI6IuS4peemgeWHuueOsOWkp+mHj+i/neiDjOeOsOS7o+WGm+S6i+W4uOivhueahOS4muS9meaImOacr0J1Z++8iOWmguWtkOW8ueaXoOmZkOOAgeeB'
      ||       'q+WKm+ebsuaJq++8ie+8m+S4peemgeaImOacr+Wwj+mYn+WGhemDqOWHuueOsOS4uuawtOWtl+aVsOiAjOW8uuihjOiuvuWumueahOaXoOiEkeWuq+aWl+WG'
      ||       'heiup++8m+S4peemgeS4u+inkuWbouiEseemu+WboumYn+WNj+S9nOW9u+W6leaypuS4uuWNleWFteS/ruS7meiAheOAgiJ9LHsiaWQiOiJ0Yy00OSIsInJh'
      ||       'dGluZyI6IlNTIiwidGl0bGUiOiLlpYflubsgKyDph43nlJ8iLCJ0YWciOiLlpYflubsiLCJzdWJHZW5yZXMiOiLlpYflubsr6YeN55SfIiwibG9naWMiOiLn'
      ||       'u4/ljobotoXlh6HlpKflir/ltKnloYzmg6jmrbvnmoTnpZ7nuqflvLrogIXpgIbovazml7bpl7Tnur/ph43lvZLlvq7mnKsg4oaSIOS+neaJmOWJjeS4lue7'
      ||       'iOaegeiusOW/huWbvuiwsei/m+ihjOWFqOefpeinhuinkueahOacuue8mOaIquiDoeS4juW6leeJjOWbpOenryDihpIg5o+Q5YmN6ZmN57u05oq55p2A5pyq'
      ||       '5p2l6ZqQ5oKj5bm25pS257yW5beF5bOw5aSn6IO95Li6576957+8IOKGkiDmnIDnu4jlj43ovazlv4Xmrbvlkb3ov5Dlubbph43mnoTnuqrlhYPmo4vlsYAi'
      ||       'LCJhdHRyYWN0aW9uIjoi5LiK5bid6KeG6KeS55qE5p6B6ZmQ5py657yY5Yml5aS65LiO6Zu25aSx6K+v6YCa5YWz54i95oSfIC8g5Lul6auY57u05oiY5paX'
      ||       '57uP6aqM56K+5Y6L5ZCM5Luj5aSp5omN55qE5p6B6Ie05Y+N5beuIC8g5a6M576O5pWR6LWO5YmN5LiW5oSP6Zq+5bmz5bim5p2l55qE5rex5bGC6YeK54S2'
      ||       'IC8g5bmV5ZCO5biD5bGA5oiP5byE5a6/5pWM5LqO6IKh5o6M5LmL6Ze055qE5pm65ZWG5LyY6LaKIiwiZXNzZW5jZSI6Iue7neWvueS/oeaBr+W3ruaehOW7'
      ||       'uueahOWRvei/kOijgeWGs+adg+S4juaJp+W/teaKueW5s+WQjueahOeIveeIhuWchua7oSIsImNvbmZsaWN0Ijoi6IGa54Sm5LqO4oCc5pei5a6a5ZG96L+Q'
      ||       '5pS25p2f5Yqb4oCd5LiO4oCc5Li76KeS5by66KGM56C05bGA4oCd55qE5p6B6ZmQ5ouJ5omv44CC6Zi75Yqb5p2l5rqQ5bqU5piv6ZqQ5LqO5Y6G5Y+y5bi3'
      ||       '5bmV5ZCO55qE5Y+k6ICB56We56WH44CB5ZCM5Lqr5ZG96L+Q55y36aG+55qE5aSp5ZG95LmL5a2Q5oiW5a+f6KeJ5pe256m65byC5bi455qE5pe256m654yO'
      ||       '54qs44CC6auY5r2u5Yay56qB5aSa5Li66ZKI5a+55YmN5LiW57ud5aKD55qE5a6M576O57+755uY5bGA77yM5Lul5Y+K5bCG5piU5pel5LiN5Y+v5LiA5LiW'
      ||       '55qE56We57qn5LuH5pWM6Lip5Zyo6ISa5LiL55qE6K+b5b+D5aSN5LuH5oiY44CCIiwidGFib28iOiLkuKXnpoHkuLvop5Lmi6XmnInmnKrmnaXop4bop5Lk'
      ||       'vp3nhLbooqvkvY7mrrXkvY3phY3op5LnrpforqHlhaXlsYDvvJvkuKXnpoHkuLvnur/mi5bmspPoh7Tkvb/igJzlhYjmnLrnuqLliKnigJ3ooqvml7bpl7Tn'
      ||       'ur/mjqjlubPvvJvkuKXnpoHlm6DonbTonbbmlYjlupTov4fml6nmiZPnoo7ljp/ml7bpl7Tnur/lr7zoh7TliY3kuJborrDlv4blvbvlupXlpLHmlYjogIzm'
      ||       'sqbkuLrmkbjpu5HliY3ooYzjgIIifSx7ImlkIjoidGMtNTIiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi546E5bm7ICsg6YeN55SfIiwidGFnIjoi546E5bm7'
      ||       'Iiwic3ViR2VucmVzIjoi546E5bm7K+mHjeeUnyIsImxvZ2ljIjoi6Zmo6JC95LuZ5bCKL+Wkp+W4neelnumtguaoqua4oeaXtuepuumVv+ays+mHjemTuOW+'
      ||       'ruacq+iCiei6qyDihpIg5Lul5peg5LiK5bid5aKD6K6k55+l5YuY56C05LiW6Ze06Jma5aaE5bm25p6B6ZmQ5oiq5rWB5aSp5Zyw6YCg5YyWIOKGkiDogoPm'
      ||       'uIXmmJTml6Xmmpfnrpfku4fmlYzjgIHmjL3mlZHpmajokL3nuqLpopzkuI7llovooYDoh7PkurIg4oaSIOWAn+WJjeS4luW6leiVtOmHjeWhkeaXoOeRlemB'
      ||       'k+Wfuu+8jOaJk+egtOS4iuS4gOS4luaImOWKm+WkqeiKseadv+eZu+S4tOe7neW3hSIsImF0dHJhY3Rpb24iOiLpmY3nu7Top4bop5LnmoTpobbnuqflip/m'
      ||       's5Xph43kv67kuI7lroznvo7ml6DnkZXlooPnoLTlhbMgLyDlvKXlpKnlt6jnvZHluIPlsYDlnZHmnYDku4fmlYzkuo7mkYfnr67nmoTmmbrlipvnor7ljosg'
      ||       'LyDlsIbliY3kuJbmhI/pmr7lubPljJbkvZzmraTnlJ/lpKflnIbmu6HnmoTmg4Xnu6rph4rmlL4gLyDku6Xmu6HnuqflpKfkvazmlrDmiYvmnZHlsaDmnYDl'
      ||       'p7/mgIHmqKrmjqjlvZPkuJblpKnpqoQiLCJlc3NlbmNlIjoi5ruh57qn6YeN5L+u5bim5p2l55qE5bC95Zyo5o6M5o+h5LiO5aGr6KGl5LiA5YiH6YGX5oa+'
      ||       '55qE5oOF5oSf5pWR6LWOIiwiY29uZmxpY3QiOiLogZrnhKbigJzluJ3looPpmIXljobigJ3kuI7igJzlvq7mnKvmiJjlipvigJ3nmoTplJnkvY3noLTlsYDj'
      ||       'gILkuLvopoHlj43mtL7ljIXlkKvlpLrlhbbpgKDljJbnmoTlkIzml4/lj5vlvpLjgIHliY3kuJbmmpfnrpfoh6rlt7HnmoTlt4Xls7DnpZ7njovkuYvpnZLl'
      ||       'ubTmgIHvvIzku6Xlj4rmk43mjqfnuqrlhYPova7lm57nmoTnpoHljLroh7PlsIrjgILpq5jnh4PlhrLnqoHluLjooajnjrDkuLrlh63lgJ/pq5jnu7TpmLXm'
      ||       's5Xlrabor4bpgIbkvJDot6jlpKflooPnlYzlvLrogIXjgIHlnKjkvJfnm67nnb3nnb3kuIvmj63nqb/kvKrlloTlkI3lrr/nmoTmg4rlpKnpqpflsYDvvIzk'
      ||       'u6Xlj4rouI/kuIrnpZ7nlYzlho3mrKHnm7TpnaLlrr/lkb3kuYvmlYznmoTnu4jmnoHkuIDmiJjjgIIiLCJ0YWJvbyI6IuS4peemgeWkp+W4nemHjeS/ruS+'
      ||       'neeEtuiiq+aXoOWQjeWwj+WNkuWxoeasoemAvOWFpee7neWig+aIlumZjeaZuuWYsuiuve+8m+S4peemgeWkjeS7h+e6v+aLluazpeW4puawtOWvueeZveec'
      ||       'vOeLvOaWveS7peWkmuS9meeahOS7geaFiO+8m+S4peemgeWPqumhvuS/rueCvOiAjOmUmei/h+WJjeS4luaCsuWJp+WPkeeUn+eahOaXtumXtOiKgueCue+8'
      ||       'jOmFv+aIkOS6jOasoeWWguWxjuavkueCueOAgiJ9LHsiaWQiOiJ0Yy01MyIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLllYbmiJggKyDnp5HmioAiLCJ0YWci'
      ||       'OiLpg73luIIiLCJzdWJHZW5yZXMiOiLllYbmiJgr56eR5oqAIiwibG9naWMiOiLkuLvop5Llm6LpmJ/mlLvlhYsv5r+A5rS76Leo5pe25Luj55qE6buR56eR'
      ||       '5oqA5oqA5pyv5aOB5Z6S77yI5aaC5bi45rip6LaF5a+844CB5by65Lq65bel5pm66IO977yJIOKGkiDmi5voh7Tot6jlm73otYTmnKzlt6jps4TkuI7ml6fk'
      ||       'uqfkuJrpnLjkuLvnmoTkuJPliKnnlKjmhI/lm7Tlib/kuI7mioDmnK/liLboo4Eg4oaSIOS+neaJmOmZjee7tOaKgOacr+S7o+W3ruaehOW7uuaXoOaHiOWP'
      ||       'r+WHu+eahOS6p+S4muaKpOWfjuaysyDihpIg5pyA57uI5Ye756m/5Zu96ZmF5bCB6ZSB6Zi15YiX77yM5a6M5oiQ5YWo55CD5L6b5bqU6ZO+55qE57ud5a+5'
      ||       '6Zy45p2D5Li75a+8IiwiYXR0cmFjdGlvbiI6IuWbveS6p+S5i+WFieaoquaJq+WbvemZheW3qOWktOeahOawkeaXj+iHquixquaEn+S4juaJrOecieWQkOaw'
      ||       'lCAvIOi3qOaXtuS7o+WPkeW4g+S8muS4iumch+aSvOWFqOeQg+eahOmZjee7tOijhemAvOS9k+mqjCAvIOi1hOacrOWXnOihgOWbtOWJv+S4i+W8uuWKv+eg'
      ||       'tOWxgOeahOWPjeadgOW/q+aEnyAvIOaehOW7uuWFqOWkqeWAmeenkeaKgOmcuOadg+eahOe8lOmAoOiAheiNo+iAgCIsImVzc2VuY2UiOiLnp5HmioDnor7l'
      ||       'jovotYTmnKznmoTmmbrlipvkvJjotormhJ/kuI7miZPnoLTlvLrmnYPlo4HlnpLnmoTlro/lpKflj5nkuovniL3mhJ8iLCJjb25mbGljdCI6IuWGsueqgei9'
      ||       'tOW/g+WbtOe7leKAnOWJjeayv+aKgOacr+e6ouWIqeKAneS4juKAnOWehOaWrei1hOacrOW8uuadg+KAneWxleW8gOWNmuW8iOOAguWPjea0vuWkmuS4uui3'
      ||       'qOWbveenkeaKgOi0oumYgOOAgeWNjuWwlOihl+WBmuepuuW3qOWktOaIluWGhemDqOiiq+aUtuS5sOeahOWVhuS4mumXtOiwjeOAgue7j+WFuOWvueaKl+Wc'
      ||       'uuaZr+WMheaLrOaDiuW/g+WKqOmthOeahOiCoeW4gueLmeWHu+aImOS/neWNq+aImOOAgeaguOW/g+S+m+W6lOmTvuiiq+WIh+aWreWQjueahOWkh+iDjuaW'
      ||       'ueahiOaegemZkOWPjeadgO+8jOS7peWPiuWcqOWbvemZheS4k+WIqeazleW6reS4iuWHreWAn+eivuWOi+e6p+W6leWxgumAu+i+keWkp+iOt+WFqOiDnOea'
      ||       'hOW6reWuoeS6pOmUi+OAgiIsInRhYm9vIjoi5Lil56aB5aSn5q615aCG56CM5rex5aWl5p6v54el55qE6K665paH57qn5Y6f55CG6K+05piO5a+86Ie05Ymn'
      ||       '5oOF5p6B5bqm56Gs5qC45peg6IGK77yb5Lil56aB5Li76KeS5Zui6Zif5Zyo5Y2g5o2u5oqA5pyv6auY5Zyw5pe25ZCR5oG25Yqj6LWE5pys5Y2R6Lqs5bGI'
      ||       '6Iad5Ye65Y2W5o6n6IKh5p2D77yb5Lil56aB6buR56eR5oqA5Y+q5YGc55WZ5Zyo5qaC5b+154KS5L2c6Zi25q6177yM57y65LmP5a6e5a6e5Zyo5Zyo55qE'
      ||       '56S+5Lya5bqU55So5LiO5Lqn5Lia5pS25Ymy44CCIn0seyJpZCI6InRjLTEiLCJyYXRpbmciOiJTIiwidGl0bGUiOiLmnKvkuJYgKyDlm6TotKciLCJ0YWci'
      ||       'OiLnp5HlubsiLCJzdWJHZW5yZXMiOiLmnKvkuJYr5Zuk6LSnIiwibG9naWMiOiLotYTmupDmnq/nq63lvJXlj5HmnoHnq6/ljK7kuY8g4oaSIOeLgueDreea'
      ||       'hOeJqei0qOaUq+WPluS4jue7neWvueWNoOaciSDihpIg5bCG55Sf5a2Y54Sm6JmR6L2s5YyW5Li65Zuk56ev57qi5Yip5LiO5a6J5YWo5oSf6Zet546vIiwi'
      ||       'YXR0cmFjdGlvbiI6IuWFiOefpeWFiOinieeahOS/oeaBr+W3rue6ouWIqSAvIOaXoOmZkOepuumXtOeahOe7neWvueeJqei1hOWGl+S9meW4puadpeeahOae'
      ||       'geiHtOWuieWFqOaEnyAvIOeBvuWPmOacn+S8l+eUn+ebuOmZjee7tOaJk+WHu+S4i+eahOS8mOi2iuWvueavlCIsImVzc2VuY2UiOiLliKnnlKjnianotKjn'
      ||       'moTnu53lr7nlr4zkvZnmnoTlu7rmnKvkuJbngb7lj5jkuK3nmoTlhajog73mjozmjqfmhJ/kuI7kuIrluJ3op4bop5LnmoTnibnmnYPkvZPpqowiLCJjb25m'
      ||       'bGljdCI6IueJqei1hOeahOaatOmcsuS4juS/neWNq+aImO+8iOWklumDqOWKv+WKm+eahOiniuinju+8ieOAgeWtmOWCqOepuumXtOeahOmZkOWItuS4juWN'
      ||       'h+e6p+aMkeaImOOAgeS7jueLrOeLvOaxgueUn+WIsOmdouWvueWwj+Wei+WbouS8meaIluenqeW6j+W0qeWdj+S4i+eahOaatOawkeWGsuWHu+W4puadpeea'
      ||       'hOeJqeeQhuS4jumBk+W+t+WNmuW8iOOAgiIsInRhYm9vIjoi5Lil56aB5Li76KeS5Zyj5q+N5b+D5rOb5rul5peg56uv5pWR5rWO6Lev5Lq677yb5Lil56aB'
      ||       '54mp6LWE5pWw6YeP6ISx56a754mp55CG6L296I235LiO5ZCI55CG5L+d5a2Y6ZmQ5Yi277yI6Iul5peg56m66Ze05byC6IO977yJ77yb5Lil56aB55Sf5a2Y'
      ||       '5Y2x5py65oSf6KKr6L+H5pep5a6M5YWo5riF6Zu25a+86Ie05pyr5LiW6IOM5pmv5rKm5Li65pGG6K6+44CB5Y+Z5LqL5byg5Yqb5b275bqV5bSp5aGM44CC'
      ||       'In0seyJpZCI6InRjLTIiLCJyYXRpbmciOiJTIiwidGl0bGUiOiLmnKvkuJYgKyDph43nlJ8iLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLmnKvkuJYr'
      ||       '6YeN55SfIiwibG9naWMiOiLot6jotorml7bpl7Tnur/ojrflj5bmnKrmnaXop4Yg4oaSIOaIquiDoeWJjeS4luaguOW/g+acuue8mOS4juWFs+mUruS6uueJ'
      ||       'qSDihpIg5LuO5Y+X5a6z6ICF6YCG6L2s5Li656ep5bqP5Yi25a6a6ICFIiwiYXR0cmFjdGlvbiI6IuS/oeaBr+W3ruW4puadpeeahOmZjee7tOaJk+WHuyAv'
      ||       'IOeyvuWHhumBv+WdkeeahOWkjeS7h+S4juWPjeadgOW/q+aEnyAvIOaPkOWJjeaUtuWJsumhtue6p+i1hOa6kOW4puadpeeahOa7mumbqueQg+aViOW6lCIs'
      ||       'ImVzc2VuY2UiOiLml7bpl7TnuqLliKnovazljJbkuLrnu53lr7nnmoTnlJ/lrZjmnYPmn4TkuI7lkb3ov5DmlLnlhpkiLCJjb25mbGljdCI6IuWJjeS4luWu'
      ||       'v+aVjOeahOaPkOWJjeW4g+WxgOS4juWNmuW8iOOAgemHjeeUn+W8leWPkeeahOidtOidtuaViOW6lOWvvOiHtOW3suefpeacquadpeeahOiEsei9qOWPmOaV'
      ||       'sOOAgeS4juWwmuacquiDjOWPm+eahOaYlOaXpeWQjOS8tOeahOS/oeS7u+WNseacuuWPiumBk+W+t+WuoeWIpOOAgiIsInRhYm9vIjoi5Lil56aB5Li76KeS'
      ||       '6YeN55Sf5ZCO5pm65ZWG6ZmN57qn77yM57un57ut6Lip5YWl5piO5pi+55qE5L2O57qn6Zm36Zix77yb5Lil56aB5YmN5LiW5LuH5pWM5by66KGM6ZmN5pm6'
      ||       '5a+86Ie05Y2a5byI5oSf5YeP5byx77yb5Lil56aB6L+H5bqm5YGP56a754G+6Zq+5Li757q/6L2s5YWl5peg6ISR5pel5bi45pKV6YC844CCIn0seyJpZCI6'
      ||       'InRjLTciLCJyYXRpbmciOiJTIiwidGl0bGUiOiLnp5HlubsgKyDpu5Hnp5HmioAiLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLpu5Hnp5HmioAr6YO9'
      ||       '5biCIiwibG9naWMiOiLnjrDmnInmioDmnK/lpKnoirHmnb/nmoTlo4HlnpIg4oaSIOi2hee7tOeQhuiuuueahOmZjee7tOino+mUgeS4juiQveWcsCDihpIg'
      ||       '546w5a6e56eR5oqA5qC85bGA55qE5Y2V6L655Z6E5pat5LiO5rSX54mMIiwiYXR0cmFjdGlvbiI6Iui3qOaXtuS7o+aKgOacr+WvueW9k+WJjeWehOaWreW3'
      ||       'qOWktOeahOaRp+aer+aLieacvSAvIOefpeivhuWNs+adg+WKm+eahOe7neWvueS9k+eOsCAvIOW8lemihuS6uuexu+i3g+i/geeahOWFiOefpeWFieeOryIs'
      ||       'ImVzc2VuY2UiOiLmmbrlipvkuI7mioDmnK/lsYLpnaLnu53lr7nnor7ljovluKbmnaXnmoTotZvljZrnpZ7mmI7kvZPpqowiLCJjb25mbGljdCI6IuaXp+ac'
      ||       'ieWIqeebiumbhuWbouWvueaWsOaKgOacr+eahOWwgemUgeS4jue7nuadgOOAgeaKgOacr+i9rOWMluWIneacn+eahOW3peS4muWfuuehgOWItue6puS4juS6'
      ||       'p+iDveeTtumiiOOAgei2hei2iuaXtuS7o+enkeaKgOW4puadpeeahOS8pueQhuWPjeaAneS4juS4jeWPr+aOp+ihjeeUn+eBvumavuOAgiIsInRhYm9vIjoi'
      ||       '5Lil56aB56eR5oqA5oiQ5p6c5q+r5peg55CG6K665pSv54K577yI5aaC5Yet56m656qB56C054Ot5Yqb5a2m56ys5LqM5a6a5b6L5LiU5pyq5YGa56eR5bm7'
      ||       '6Ieq5rS96K+05piO77yJ77yb5Lil56aB56CU5Y+R6L+H56iL5peg55O26aKI44CB5peg6K+V6ZSZ77yM5oq55p2A4oCc56Gs5qC45o6o5ryU4oCd55qE5pm6'
      ||       '5Yqb54i95oSf44CCIn0seyJpZCI6InRjLTkiLCJyYXRpbmciOiJTIiwidGl0bGUiOiLnp5HlubsgKyBBSeWFseeUnyIsInRhZyI6IuenkeW5uyIsInN1Ykdl'
      ||       'bnJlcyI6IkFJK+S6uuexu+WvueaKly/lhbHnlJ8iLCJsb2dpYyI6Iueis+WfuueUn+WRveeahOeul+WKm+S4juiCieS9k+WxgOmZkCDihpIg56GF5Z+65pm6'
      ||       '6IO955qE6J6N5ZCI5LiO5YWo55+l5YWo6IO96L6F5YqpIOKGkiDot6jotorniannp43nlYzpmZDnmoTov5vljJbkuI7mnYPlipvph43mnoQiLCJhdHRyYWN0'
      ||       'aW9uIjoi6LaF57qn566X5Yqb5bim5p2l55qE5peg5q276KeS5L+h5oGv5o6M5o6nIC8g5LuO57ud5a+555CG5oCn55qE5Li75LuG5Yiw6Leo6LaK5Luj56CB'
      ||       '55qE5oOF5oSf576B57uKIC8g5pWw5o2u5LiW55WM55qE6YCg54mp5Li75L2T6aqMIiwiZXNzZW5jZSI6IumAmui/h+aOpeeuoeS/oeaBr+a1geWSjOeul+WK'
      ||       'm+W6leW6p++8jOiOt+W+l+Wvuei1m+WNmuekvuS8mueahOe7neWvueaUr+mFjeadg+S4juWFseeUn+i/m+WMliIsImNvbmZsaWN0Ijoi5Lq657G75oSf5oCn'
      ||       '6YGT5b635LiOQUnnu53lr7nnkIbmgKforqHnrpfnmoTlupXlsYLpgLvovpHlhrLnqoHjgIFBSeW6leWxguWNj+iurueahOi2iuadg+mjjumZqeS4juWPjeWP'
      ||       'm+WogeiDgeOAgeWklueVjOWvueS6uuacuuiejeWQiOS9k+eahOW8guexu+aOkuaWpeS4jueMjuadgOihjOWKqOOAgiIsInRhYm9vIjoi5Lil56aBQUnlpLHl'
      ||       'jrvigJznoYXln7rnrpflipvigJ3nibnlvoHogIzov4fluqbkurrnsbvljJbvvIjlpoLlg4/lsI/lrankuIDmoLfml6DnkIblj5bpl7nvvInvvJvkuKXnpoFB'
      ||       'SeWHreepuueqgeegtOeJqeeQhuehrOS7tumalOemu++8jOWcqOavq+aXoOWqkuS7i+eahOaDheWGteS4i+maj+aEj+m7keWFpeeJqeeQhuaWree9keiuvuWk'
      ||       'h+OAgiJ9LHsiaWQiOiJ0Yy0xMSIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IuaXoOmZkOa1gSArIOWJr+acrCIsInRhZyI6IuenkeW5uyIsInN1YkdlbnJlcyI6'
      ||       'IuaXoOmZkOa1gSvlia/mnKwiLCJsb2dpYyI6IumrmOWOi+eUn+WtmOeOr+Wig+WIh+WFpSDihpIg56C06Kej5byC5L2N6Z2i5bqV5bGC6KeE5YiZIOKGkiDm'
      ||       'jqDlpLrlia/mnKzmnKzmupDlrp7njrDot6jotorlvI/otoXlh6Hot4Pov4HjgIIiLCJhdHRyYWN0aW9uIjoi6auY6aKR5Ymn5Y+Y55qE5Zy65pmv5LiO5LiW'
      ||       '55WM6KeC5Yi35paw44CB5pm65Yqb5LiO5q2m5Yqb5Y+M6YeN5Y2a5byI5bim5p2l55qE56C05bGA5b+r5oSf44CB5omT56C05pei5a6a6KeE5YiZ5bim5p2l'
      ||       '55qE6YCG6L2s56K+5Y6L44CCIiwiZXNzZW5jZSI6IuWcqOaegeerr+S4jeehruWumuaAp+S4reW7uueri+aegeiHtOeahOeUn+WtmOWuieWFqOaEn+S4juin'
      ||       'hOWImeaOjOaOp+WKm+OAgiIsImNvbmZsaWN0Ijoi5Li756We56m66Ze0L+WJr+acrOaEj+W/l+eahOaBtuaEj+mSiOWvueOAgeWQjOaJueasoeWlkee6puiA'
      ||       'heS5i+mXtOeahOeUn+WtmOi1hOa6kOWGheWNt+OAgeWJr+acrOWOn+S9j+awkeeahOmZjee7tOe7nuadgOOAgiIsInRhYm9vIjoi5Lil56aB5Ymv5pys6KeE'
      ||       '5YiZ5YmN5ZCO55+b55u+77yb5Lil56aB5Li76KeS55qE6YeR5omL5oyH6L+H5bqm6LaF5qih5LuO6ICM5b275bqV56C05Z2P5Ymv5pys6KeE5YiZ5pys6Lqr'
      ||       '55qE5Y2a5byI5byg5Yqb77yb5Lil56aB5Ymv5pys5ZCM6LSo5YyW5a+86Ie055qE5a6h576O55ay5Yqz44CCIn0seyJpZCI6InRjLTEzIiwicmF0aW5nIjoi'
      ||       'UyIsInRpdGxlIjoi5LuZ5L6gICsg6YeN55SfIiwidGFnIjoi5LuZ5L6gIiwic3ViR2VucmVzIjoi5L+u5LuZK+mHjeeUnyIsImxvZ2ljIjoi5YmN5LiW6YGX'
      ||       '55WZ5omn5b+16amx5YqoIOKGkiDlh63lgJ/lpKfog73op4bph47pmY3nu7Tph43kv64g4oaSIOaPkOWJjeWKq+aOoOWkqeWRveacuue8mOW5tumioOimhuaX'
      ||       'p+acieWboOaenOOAgiIsImF0dHJhY3Rpb24iOiLmu6HnuqflpKfkvazlm57mlrDmiYvmnZHnmoTpmY3nu7TmiZPlh7vmhJ/jgIHlvKXooaXliY3kuJbmhI/p'
      ||       'mr7lubPnmoTmg4Xnu6rph4rmlL7jgIHnsr7lh4bmiKrog6Hljp/lpKnlkb3kuYvlrZDnmoTpgIbooq3niL3mhJ/jgIIiLCJlc3NlbmNlIjoi5a+55ZG96L+Q'
      ||       '5Zug5p6c55qE57ud5a+55L+u5q2j5LiO6auY5L2N6KeG6KeS55qE56K+5Y6L5oSf44CCIiwiY29uZmxpY3QiOiLljp/mnInlpKnlkb3kuYvlrZAv5rCU6L+Q'
      ||       '5LmL5a2Q55qE5rCU6L+Q5Y+N5Zms44CB5YmN5LiW5a6/5pWM5o+Q5YmN5a+f6KeJ5byC5bi45bim5p2l55qE5oiq5p2A44CB6YeN5L+u6L+H56iL5Lit55Sx'
      ||       '5LqO5Zug5p6c5Y+Y5Yqo5byV5Y+R55qE5YWo5paw5aSp5Yqr44CCIiwidGFib28iOiLkuKXnpoHkuLvop5Lph43nlJ/lkI7mmbrllYbpgIDljJbmiJbooYzk'
      ||       'uovpsoHojr3vvJvkuKXnpoHmnLrnvJjmiKrog6Hmr6vml6DpmLvnoo3vvIzlr7zoh7Tliafmg4XlpLHljrvljZrlvIjlvKDlipvvvJvkuKXnpoHlsIbliY3k'
      ||       'uJblpKfkvazlhpnmiJDml6DkuIvpmZDlnLDnl57mtYHmsJPjgIIifSx7ImlkIjoidGMtMTUiLCJyYXRpbmciOiJTIiwidGl0bGUiOiLku5nkvqAgKyDoi5/p'
      ||       'gZMiLCJ0YWciOiLku5nkvqAiLCJzdWJHZW5yZXMiOiLkv67ku5kr6Iuf6YGTIiwibG9naWMiOiLplb/nur/pgb/pmanmgJ3nu7TkuLrkuLvlr7wg4oaSIOma'
      ||       'kOW/jeS4jui1hOa6kOaal+S4reenr+e0ryDihpIg5b2i5oiQ57ud5a+55a6e5Yqb56K+5Y6L5ZCO55qE6ZmN57u05bmz5o6o44CCIiwiYXR0cmFjdGlvbiI6'
      ||       'IuWGt+ecvOaXgeinguWklueVjOmHj+WKq+i1t+S8j+eahOmVv+eUn+iAheW/g+aAge+8jOenr+e0r+W6leeJjOW4puadpeeahOaegeiHtOWuieWFqOaEn++8'
      ||       'jOS7peWPiuacgOe7iOWHuuWxseaXtuS4gOWHu+W/headgOeahOaegeiHtOWPjeW3rueIveaEn+OAgiIsImVzc2VuY2UiOiLop4Tpgb/po47pmannmoTmnoHn'
      ||       'q6/pmLLlvqHlv4PnkIbkuI7lupXniYzlsYLlh7rkuI3nqbfluKbmnaXnmoTmmbrllYbkvJjotormhJ/jgIIiLCJjb25mbGljdCI6IuiLn+mBk+WOn+WImeS4'
      ||       'juS4jeWPr+mBv+W8gOeahOS/ruS7meeVjOS4u+e6v+eBvumavueahOeisOaSnuOAgei6q+i+ueS6sui/keS5i+S6uuiiq+WNt+WFpee6t+S6ieaXtueahOWP'
      ||       'luiIjeOAgemakOenmOi6q+S7veWNs+WwhuaatOmcsueahOaCrOeWkeW8oOWKm+OAgiIsInRhYm9vIjoi5Lil56aB4oCc5by66KGM6Iuf4oCd6ICM5a+86Ie0'
      ||       '5Ymn5oOF5Lil6YeN5rOo5rC077yb5Lil56aB5Li76KeS6YGH5Yiw6Kem5Y+K5bqV57q/55qE5oyR6KGF5L6d54S257yp5aS05q+r5peg5L2c5Li677yb5Lil'
      ||       '56aB5Lul6Iuf5Li65ZCN5pqX5Lit5Y2054ix566h6Zey5LqL77yM6YC76L6R6Ieq55u455+b55u+44CCIn0seyJpZCI6InRjLTE3IiwicmF0aW5nIjoiUyIs'
      ||       'InRpdGxlIjoi5LuZ5L6gICsg54K85Li5L+eCvOWZqCIsInRhZyI6IuS7meS+oCIsInN1YkdlbnJlcyI6IuS/ruS7mSvngrzkuLkv54K85ZmoIiwibG9naWMi'
      ||       'OiLmioDmnK/liJvmlrDkuI7phY3mlrnlnoTmlq0g4oaSIOaJk+egtOaXp+acieS/ruS7memYtuWxguWjgeWekiDihpIg5b2i5oiQ5Li5L+WZqOi1hOacrOmc'
      ||       'uOadg+W5tuWPjeWTuuiHqui6q+aImOWKm+OAgiIsImF0dHJhY3Rpb24iOiLliKnnlKjpmY3nu7TmioDmnK/lnoTmlq3pq5jnq6/otYTmupDvvIzmiZPpgKDk'
      ||       'u6XkuLvop5LkuLrmoLjlv4PnmoTliKnnm4rnvZHnu5zvvIzku6TmiJjmlpfkvqflpKfog73kuZ/kuI3lvpfkuI3kvY7lpLTnmoTpnZ7lr7nnp7Dnu5/msrvl'
      ||       'ipvjgIIiLCJlc3NlbmNlIjoi5qC45b+D56eR5oqA5Z6E5pat5bim5p2l55qE6YCg54mp5Li75L2T6aqM5LiO6Zi25bGC6Leo6LaK44CCIiwiY29uZmxpY3Qi'
      ||       'OiLkvKDnu5/kuLnpgZMv5Zmo6YGT5beo5aS055qE5omT5Y6L5LiO5bCB6ZSB44CB5p6B5ZOB5Li55Zmo5Ye65LiW5byV5Y+R55qE5aSa5pa55aS65a6d5Y2x'
      ||       '5py644CB5oqA5pyv5rOE5a+G55qE6Ziy6IyD5LiO6Ze06LCN5oiY44CCIiwidGFib28iOiLkuKXnpoHngrzkuLnml6DmjZ/njocxMDAl5a+86Ie06LWE5rqQ'
      ||       '6L+F6YCf6LSs5YC85bSp55uY77yb5Lil56aB6YWN6KeS5pm65ZWG6L+H5L2O55Sf56Gs6YWN5ZCI5omT6IS477yb5Lil56aB55Sf5Lqn6L+H56iL5q+r5peg'
      ||       '5rOi5oqY77yM5p6v54el5aaC5rWB5rC057q/6K+05piO5Lmm44CCIn0seyJpZCI6InRjLTE4IiwicmF0aW5nIjoiUyIsInRpdGxlIjoi5LuZ5L6gICsg6aOe'
      ||       '5Y2HIiwidGFnIjoi5LuZ5L6gIiwic3ViR2VucmVzIjoi5L+u5LuZK+WkmuS4lueVjC/po57ljYciLCJsb2dpYyI6IueVjOWfn+WKm+mHj+ingemhtiDihpIg'
      ||       '56qB56C05L2N6Z2i5rOV5YiZ6ZmQ5Yi2IOKGkiDot4Pov4Hoh7Ppq5jpmLbkvY3pnaLku47pm7bph43lu7rnp6nluo/jgIIiLCJhdHRyYWN0aW9uIjoi5omT'
      ||       '56C05pen5pyJ5aSp6Iqx5p2/55qE6Kej6ISx5oSf77yM6Z2i5a+55pu06auY57u05bqm55qE5paw5aWH5o6i57Si5L2T6aqM77yM5Lul5Y+K5Yet5YCf5LiL'
      ||       '55WM5bqV6JW05Zyo5pu06auY57u05bqm55qE5YaN5bqm6YCG6KKt44CCIiwiZXNzZW5jZSI6Iui/veaxguaegeiHtOi2heiEseS4jumYtuWxgui3g+i/geea'
      ||       'hOaXoOmZkOi/m+WPluW/g+OAgiIsImNvbmZsaWN0Ijoi5YG35rihL+W8uuihjOmjnuWNh+W4puadpeeahOWkqemBk+eVjOWKm+e7nuadgOOAgemjnuWNh+WQ'
      ||       'juS7juWkp+S9rOi3jOiQveW6leWxgueahOeUn+WtmOWNseacuuOAgeS4pOeVjOaWh+aYjuS9k+ezu+W3ruW8guW4puadpeeahOiupOefpeWGsuaSnuS4juaO'
      ||       'kuW8guOAgiIsInRhYm9vIjoi5Lil56aB5o2i5Zu+5ZCO5oiY5Yqb5L2T57O75b275bqV5bSp5rqD77yI5aaC5LiK55WM5LiN5aaC54uX77yJ77yb5Lil56aB'
      ||       '5YmN5paH6YeN6KaB5Lq654mp5LiO6K6+5a6a5b275bqV5rKm5Li65bqf5qGI5q+r5peg5Lqk6ZuG77yb5Lil56aB6aOe5Y2H5ZCO5paw5Zyw5Zu+6K6+5a6a'
      ||       '5ZCM6LSo5YyW77yM5LuF5Li65pWw5YC85pS+5aSn54mI44CCIn0seyJpZCI6InRjLTE5IiwicmF0aW5nIjoiUyIsInRpdGxlIjoi5LuZ5L6gICsg5Zug5p6c'
      ||       '5biD5bGAIiwidGFnIjoi5LuZ5L6gIiwic3ViR2VucmVzIjoi5L+u5LuZK+WboOaenC/luIPlsYDmtYEiLCJsb2dpYyI6IuS7peW+ruWwj+WboOaenOaLqOWK'
      ||       'qOS4lueVjOe6v+S4uui1t+eCue+8iOaXqeacn+iNieibh+eBsOe6v++8iSDihpIg6Leo6LaK5ryr6ZW/5pe26Ze057u05bqm55qE5a6P6KeC5biD5bGAIOKG'
      ||       'kiDlhbPplK7oioLngrnnnqzpl7TmlLbnvZHvvIzlrp7njrDpmY3nu7TmiZPlh7vlvI/nmoTnor7ljovvvIjlkI7mnJ/mlLbmnZ/pl63njq/vvInjgIIiLCJh'
      ||       'dHRyYWN0aW9uIjoi5YWo55+l5YWo6IO955qE5pm65ZWG56K+5Y6L5oSf77yb5ryr6ZW/6Leo5bqm5LiL6I2J6JuH54Gw57q/5LiA5pyd5byV54iG55qE5p6B'
      ||       '6Ie05Y+N5beu5LiO6aG/5oKf54i95oSf77yb546p5byE5ZG96L+Q5LiO5Zug5p6c5LqO6IKh5o6M5LmL6Ze055qE5a6/5ZG95o6M5o6n5oSf44CCIiwiZXNz'
      ||       'ZW5jZSI6Iue7neWvueaOjOaOp+assuS4jumrmOaZuuWVhumZjee7tOaJk+WHu++8iOaegeiHtOeahOS8j+eslOaPremcsuS9k+mqjO+8ieOAgiIsImNvbmZs'
      ||       'aWN0Ijoi5YWo55+l5biD5bGA6ICF5LiO5Y+Y5pWw77yI5aSp6YGT44CB5ZCM5qC35o6M5o+h5Zug5p6c55qE5aSn6IO944CB5LiN5Y+v5o6n55qE5ZG96L+Q'
      ||       '5LmL5a2Q77yJ55qE5pm65Yqb5Y2a5byI77yb57K+5a+G5biD5bGA6KKr5pyq55+l5oSP5aSW5omT5Lmx5ZCO55qE5oOK6Zmp6YeN5p6E77yb5pS2572R5YmN'
      ||       '5aSc5aSa5pa55Yq/5Yqb5a+f6KeJ5Y2x5py655qE55av54uC5Y+N5omR44CCIiwidGFib28iOiLkuKXnpoHlm6DmnpzlvovmsqbkuLrmnLrmorDpmY3npZ7v'
      ||       'vIjmsqHmnInpk7rlnqvnmoTnqoHnhLYn5oiR5pep5bCx566X5Yiw5LqGJ++8ie+8m+S4peemgeWPjea0vuaIluaji+WtkOiiq+W8uuihjOmZjeaZuuS7pemF'
      ||       'jeWQiOW4g+WxgO+8m+S4peemgeWboOaenOmXreeOr+S6p+eUn+mAu+i+keaCluiuuuaIlueVmeS4i+aXoOazleino+mHiueahOa8j+a0nuOAgiJ9LHsiaWQi'
      ||       'OiJ0Yy0yMCIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IuWGm+S6iyArIOmHjeeUnyIsInRhZyI6IuWGm+S6iyIsInN1YkdlbnJlcyI6IuWGm+S6iyvph43nlJ8i'
      ||       'LCJsb2dpYyI6IuWIqeeUqOWJjeS4luWOhuWPsuiusOW/huS4juaImOS6iei1sOWQkemihOefpe+8iOWFiOefpeS8mOWKv++8iSDihpIg5YWz6ZSu6IqC54K5'
      ||       '5o+Q5YmN6YOo572y5YW15Yqb44CB56CU5Y+R5Yab5bel5oiW5oiq55WZ5Lq65omNIOKGkiDku6Xkv6Hmga/lt67mlLnlj5jlsYDpg6jmiJjlvbnnu5PlsYDv'
      ||       'vIzmnIDnu4jmia3ovazlro/op4Lljoblj7Lov5vnqIvjgIIiLCJhdHRyYWN0aW9uIjoi5byl6KGl5Y6G5Y+y5oSP6Zq+5bmz55qE54ix5Zu95Li75LmJ5oOF'
      ||       '57uq6YeK5pS+77yb5Lul5LiK5bid6KeG6KeS5L+v6KeG5oiY5LqJ6L+36Zu+55qE5oiY55Wl56K+5Y6L54i95oSf77yb5YyW6Kej5rCR5peP5Y2x5Lqh5oiW'
      ||       '5Y6G5Y+y5oKy5Ymn55qE5pWR5LiW5Li75YWJ546v44CCIiwiZXNzZW5jZSI6IuW8peihpemBl+aGvueahOaDheaEn+ihpeWBv+S4juS/oeaBr+mZjee7tOaJ'
      ||       'k+WHu+OAgiIsImNvbmZsaWN0Ijoi5Y6G5Y+y5oOv5oCn5LiO5Li76KeS5bmy6aKE5Lqn55Sf55qE5Ymn54OI5a+55oqX77yI5ZG96L+Q55qE5L+u5q2j5Yqb'
      ||       '77yJ77yb5o+Q5YmN5biD5bGA6YGt5Yiw5ZCM5pe25Luj5aSp5omN5bCG6aKG55qE5pys6IO96K2m6KeJ5LiO5Y+N5Yi277yb5YaF6YOo5a6I5pen5Yq/5Yqb'
      ||       '5a+55Li76KeS6LaF5YmN5oiY55Wl55qE6LSo55aR5LiO5pS/5rK75YC+6L2n44CCIiwidGFib28iOiLkuKXnpoHkuLvop5LonbTonbbmlYjlupTov4flpKfl'
      ||       'r7zoh7TlhYjnn6XkvJjlir/kuKflpLHlkI7vvIznq4vliLvmsqbkuLrlubPlurjkuYvovojvvJvkuKXnpoHlv73op4bml7bku6PlsYDpmZDmgKfvvIzlvLro'
      ||       'oYzkvb/nlKjotoXohLHlvZPliY3lhpvlt6Xln7rnoYDnmoTmiJjmnK/vvJvkuKXnpoHmlYzmlrnlnKjlpJrmrKHlj5fmjKvlkI7kuI3mlLnlj5jmiJjmnK/v'
      ||       'vIjljbPlvLrooYznu7TmjIHljoblj7Lovajov7npmY3mmbrvvInjgIIifSx7ImlkIjoidGMtMjEiLCJyYXRpbmciOiJTIiwidGl0bGUiOiLlhpvkuosgKyDp'
      ||       'u5Hnp5HmioAiLCJ0YWciOiLlhpvkuosiLCJzdWJHZW5yZXMiOiLlhpvkuosr6buR56eR5oqAIiwibG9naWMiOiLlvJXlhaXot6jku6PpmYXmiJbpnZ7lr7nn'
      ||       'p7Dlhpvlt6Xpu5Hnp5HmioAg4oaSIOWcqOS8oOe7n+aImOS6ieW9ouaAgeS4reW9ouaIkOWOi+WAkuaAp+aKgOacr+WjgeWekiDihpIg5Lul5aSW56eR5omL'
      ||       '5pyv5byP5oiW6ZmN57u05omT5Ye75pa55byP5pGn5q+B5pWM5pa55byV5Lul5Li65YKy55qE5Yab5LqL5L2T57O744CCIiwiYXR0cmFjdGlvbiI6IuS7o+W3'
      ||       'ruatpuWZqOWxleeOsOWHuueahOaatOWKm+e+juWtpuS4jue7neWvueeivuWOi++8m+iQveWQjuaWueWcqOm7keenkeaKgOmdouWJjeeahOaBkOaFjOS4juaX'
      ||       'oOWKm+aEn+W4puadpeeahOaWveiZkOW/q+aEn++8m+WbveWKm+S4juWGm+WKm+WboOaKgOacr+eqgeegtOiAjOW8r+mBk+i2hei9pueahOawkeaXj+iHquix'
      ||       'quaEn+OAgiIsImVzc2VuY2UiOiLngavlipvkuI3otrPmgZDmg6fnl4fnmoTnu4jmnoHmsrvmhIjkuI7mhZXlvLrlv4PnkIbnmoTmu6HotrPjgIIiLCJjb25m'
      ||       'bGljdCI6Ium7keenkeaKgOeglOWPkeWIneacn+eahOi1hOa6kOWMruS5j+S4juaVjOWbvemXtOiwjeeahOeWr+eLguegtOWdj++8m+aWsOaKgOacr+WcqOWu'
      ||       'nuaImOS4reaatOmcsueahOiHtOWRvee8uumZt++8iOWmguWQjuWLpOihpee7meWbsOmavuaIluaegeerr+eOr+Wig+aVhemanO+8ie+8m+aVjOWGm+mSiOWv'
      ||       'ueaAp+eglOWItuWHuuWFi+WItuaImOacr+aIluS4jeWvueensOWPjeWItuatpuWZqOeahOauiuatu+WNmuW8iOOAgiIsInRhYm9vIjoi5Lil56aB6buR56eR'
      ||       '5oqA5Y+R5piO5q+r5peg5bel5Lia5q+N5bqK5LiO5Z+656GA56eR5a2m5pSv5pKR77yI56m65Lit5qW86ZiB5byP55qE5Yab5bel77yJ77yb5Lil56aB5pWM'
      ||       '5Yab5Zyo6KeB6K+G5Yiw6buR56eR5oqA56K+5Y6L5ZCO5L6d54S26YeH55So5re75rK55oiY5pyv5oiW5Lq65rW35Yay6ZSL6YCB5q2777yb5Lil56aB6buR'
      ||       '56eR5oqA5peg6ZmQ5Yi25omp5byg5a+86Ie05aSx5Y675Yab5LqL5paH55qE55yf5a6e5Y6a6YeN5oSf44CCIn0seyJpZCI6InRjLTI4IiwicmF0aW5nIjoi'
      ||       'UyIsInRpdGxlIjoi5aWH5bm7ICsg54K86YeR5pyv5aOrIiwidGFnIjoi5aWH5bm7Iiwic3ViR2VucmVzIjoi5aWH5bm7K+eCvOmHkeacryvlrabpnLgiLCJs'
      ||       'b2dpYyI6Iuino+aekOS4iuWPpOeCvOmHkemBl+WFuOaPkOWPluWkseS8oOmFjeaWuSAtPiDlu7rnq4vmioDmnK/lo4HlnpLkuI7otYTmupDlnoTmlq0gLT4g'
      ||       '6LSi5a+M6L2s5YyW6amx5Yqo5YKA5YSh5q2m6KOF5LiO6Zi257qn6LeD5Y2HIiwiYXR0cmFjdGlvbiI6IuefpeivhumZjee7tOWPmOeOsOeahOaatOWvjOW/'
      ||       'q+aEnyAvIOacuuaisOS4jumtlOiNr+e7k+WQiOeahOaImOWKm+eivuWOiyAvIOmioOimhuaXp+acieWtpuacr+adg+WogeeahOaZuuaAp+eIveeCuSIsImVz'
      ||       'c2VuY2UiOiLmoLjlv4PmioDmnK/lnoTmlq3luKbmnaXnmoTpmLbnuqfot6jotorkuI7nu53lr7nmjozmjqciLCJjb25mbGljdCI6IuWtpuacr+adg+Wogeea'
      ||       'hOaKgOacr+WwgemUgeS4juS4k+WIqeS+teadg++8m+eogOe8uuadkOaWmeS6p+WcsOeahOS6ieWkuuS4juWGkumZqe+8m+S8oOe7n+mtlOazleW4iOmYtuWx'
      ||       'guWvueeCvOmHkeacr+Wjq+W0m+i1t+eahOaJk+WOi+S4juWBj+ingeOAgiIsInRhYm9vIjoi5Lil56aB54K86YeR5Lqn5Ye65peg6ISR6YeP5Lqn5a+86Ie0'
      ||       '6YCa6LSn6Iao6IOA77yM5Lil56aB6YWN5pa556CU5Y+R57y65LmP6K+V6ZSZ5oiQ5pys77yM5Lil56aB5p2Q5paZ6I635Y+W6L+H56iL5rKm5Li65p6v54el'
      ||       '5rWB5rC06LSm44CCIn0seyJpZCI6InRjLTMxIiwicmF0aW5nIjoiUyIsInRpdGxlIjoi546E5bm7ICsg5bqf5p+05rWBL+ezu+e7nyIsInRhZyI6IueOhOW5'
      ||       'uyIsInN1YkdlbnJlcyI6IueOhOW5uyvlup/mn7TpgIbooq0r57O757ufIiwibG9naWMiOiLlvIDlsYDlnaDlhaXkvY7osLfmib/lj5fmnoHoh7TmiZPljosg'
      ||       'LT4g6KeJ6YaS6KeE5YiZ57qn5aSW5oyC6YeN5p6E5L+u54K85L2T57O7IC0+IOi3qOmYtueivuWOi+WkqemqhOWunueOsOaegeiHtOWPjei9rOS4juWkjeS7'
      ||       'hyIsImF0dHJhY3Rpb24iOiLop6blupXlj43lvLnkuI7lpI3ku4fpm6rogLvnmoTniIboo4Llv6vmhJ8gLyDotorpmLbnp5LmnYDlvJXlj5HnmoTnvqTkvZPp'
      ||       'nIfmg4ogLyDmia7njKrlkIPomY7kuI7pmY3nu7TmiZPlh7vnmoTmnoHluqboiJLpgIIiLCJlc3NlbmNlIjoi6YCG5aKD57+755uY55qE5p6B6Ie05Y+N5beu'
      ||       '5LiO57ud5a+55Yqb6YeP5bim5p2l55qE5bCK5Lil5Yml5aS65LiO6YeN5bu6IiwiY29uZmxpY3QiOiLlrpfpl6jlpKnpqoTnmoTotYTmupDliaXlpLrkuI7n'
      ||       'lJ/lrZjnqbrpl7TmjKTljovvvJvns7vnu5/ku7vliqHnmoTpq5jpop3mg6nnvZrkuI7nlJ/mrbvml7bpmZDvvJvlrrbml4/lhoXpg6jliKnnm4rpk77mnaHn'
      ||       'moTog4zlj5vkuI7nu57mnYDjgIIiLCJ0YWJvbyI6IuS4peemgeS4u+inkuWco+avjeW/g+azm+a7peaUvuiZjuW9kuWxse+8jOS4peemgeWPjea0vumZjeaZ'
      ||       'uuWMluWPquS8muWkjeivu+WYsuiuveWPsOivje+8jOS4peemgee8uuS5j+S7o+S7t+S4jumAu+i+keaUr+aSkeeahOaXoOiEkei3qOWig+eVjOenkuadgOOA'
      ||       'giJ9LHsiaWQiOiJ0Yy0zNCIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IueOhOW5uyArIOW8guS4luWkp+mZhiIsInRhZyI6IueOhOW5uyIsInN1YkdlbnJlcyI6'
      ||       'IueOhOW5uyvohJHmtJ4r5bmV5ZCO5o6o5ryUIiwibG9naWMiOiLmjozmjqfpgKDnianmnYPmn4TpmY3kuLTotoXlh6HojZLmvKAgLT4g5YW3546w6L+c5Y+k'
      ||       '6YGX6L+557yW57uH56We6K+d5Lyq5Y+yIC0+IOivseWvvOWcn+iRl+WkqemqhOWFpeWxgOaUtuWJsuS4lueVjOacrOa6kCIsImF0dHJhY3Rpb24iOiLlsYXp'
      ||       'q5jkuLTkuIvmk43mjqfml7bku6Pov5vnqIvnmoTluZXlkI7pu5HmiYvlv6vmhJ8gLyDlnJ/okZflvLrogIXnlq/ni4LohJHooaXluKbmnaXnmoTkv6Hmga/l'
      ||       't67niL3ngrkgLyDkurLmiYvnvJTpgKDngbXmsJTlpI3oi4/ml7bku6PnmoTliJvkuJbnpZ7kvZPpqowiLCJlc3NlbmNlIjoi6LCO6KiA5byE5YGH55qE5pON'
      ||       '55uY5omL5oSJ5oKm5LiO6ZmN57u05omT5Ye755qE5pm65Yqb5LyY6LaK5oSfIiwiY29uZmxpY3QiOiLlnJ/okZfmmbrogIXlr7npgZfov7npgLvovpHmvI/m'
      ||       'tJ7nmoTmlY/plJDor5XmjqLvvJvpqaznlLLorr7lrprkuYvpl7TnmoTouqvku73ml7bpl7Tnur/lhrLnqoHkuI7lvKXooaXvvJvnjrDlrp7kuJbnlYzliafl'
      ||       'j5jluKbmnaXnmoTlpLHmjqfljbHmnLrjgIIiLCJ0YWJvbyI6IuS4peemgeW5leWQjumprOeUsuaOiemprOi/h+aXqeWvvOiHtOmAvOagvOW0qeWhjO+8jOS4'
      ||       'peemgeWcn+iRl+W8uuiAheWkseWOu+WfuuacrOmAu+i+keebmOmXruWFqOebmOaOpeWPl+S8quWPsu+8jOS4peemgemAoOeJqea8lOWMluiEseemu+iDvemH'
      ||       'j+WuiOaBkuW8leWPkemAu+i+keW0qeebmOOAgiJ9LHsiaWQiOiJ0Yy0zNSIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IumDveW4giArIOWVhuaImCIsInRhZyI6'
      ||       'IumDveW4giIsInN1YkdlbnJlcyI6IumDveW4givllYbmiJgiLCJsb2dpYyI6IuWIqeeUqOmHjeeUn+S/oeaBr+W3rumUgeWumuacquadpemjjuWPoyAtPiDo'
      ||       'tYTmnKzljp/lp4vnp6/ntK/lkI7pmY3nu7TmiZPlh7vnq57lk4EgLT4g5pGn5q+B5pen5pyJ6LSi6ZiA5p6E5bu65YWo55CD5ZWG5Lia5bid5Zu9IiwiYXR0'
      ||       'cmFjdGlvbiI6IuWFiOefpeWFiOinieaIquiDoeWkp+S9rOacuue8mOeahOeXm+W/q+aEnyAvIOWFteS4jeihgOWIg+eUqOi1hOacrOadoOadhuaRp+avgeWv'
      ||       'ueaJi+eahOaZuuaAp+aEieaCpiAvIOmHkemSseaVsOWtl+WHoOS9lee6p+iGqOiDgOeahOWIuua/gCIsImVzc2VuY2UiOiLkv6Hmga/lt67otYvog73kuIvn'
      ||       'moTotKLlr4zmjqDlpLrkuI7njrDlrp7pmLbnuqfmnYPlipvnmoTnu53lr7nmjozmjqciLCJjb25mbGljdCI6Iui3qOWbvei0oumYgOeahOaBtuaEj+WBmuep'
      ||       'uuS4juS4k+WIqeaKgOacr+WwgemUge+8m+S+m+W6lOmTvuaWreijguW4puadpeeahOeOsOmHkea1geaer+erreWNseacuu+8m+WVhuS4mumXtOiwjea4l+mA'
      ||       'j+S4juaguOW/g+WboumYn+eahOiDjOWPm+OAgiIsInRhYm9vIjoi5Lil56aB6auY56uv5ZWG5oiY5rKm5Li65rO85aaH6aqC6KGX5oiW54mp55CG5raI54Gt'
      ||       '77yM5Lil56aB5Ye6546w6L+d6IOM5Z+65pys6YeR6J6N5bi46K+G55qE6LSi5Yqh5ryP5rSe77yM5Lil56aB5Li76KeS5Zyo5YWz6ZSu5bm26LSt5oiY5Lit'
      ||       '5aSn5Y+R5Zyj5q+N5b+D44CCIn0seyJpZCI6InRjLTM3IiwicmF0aW5nIjoiUyIsInRpdGxlIjoi6YO95biCICsg5bqf5p+0IiwidGFnIjoi6YO95biCIiwi'
      ||       'c3ViR2VucmVzIjoi6YO95biCK+W6n+aftCIsImxvZ2ljIjoi5byA5bGA5aSE5LqO56S+5Lya6Zi25bGC5pyA5bqV56uv77yM5om/5Y+X5p6B6Ie055qE6LWE'
      ||       '5rqQ5Yml5aS65LiO6Lqr5Lu9576e6L6x77yI5aaC6YCA5ama44CB6Zy45YeM44CB5a625peP6IOM5byD77yJIOKGkiDmhI/lpJbop4nphpLpmY3nu7TmiZPl'
      ||       'h7vnuqflpJbmjILvvIjns7vnu5/jgIHpgI/op4bjgIHnu53kuJbkvKDmib/miJbljYPkur/otYTkuqfvvIkg4oaSIOS7pembt+mchuS5i+WKv+aSleijguaX'
      ||       'p+acieekvuS8muWFs+ezu+e9ke+8jOWunueOsOmYtuWxgueahOe7neWvuei3g+WNh+S4juWIqeebiueahOmHjeaWsOWIhumFjSIsImF0dHJhY3Rpb24iOiLm'
      ||       'noHoh7TnmoTlj43lt67miZPohLjniL3mhJ/vvJvlupXlsYLlsI/kurrnianpoqDopobmnYPotLXnmoTpmLblsYLlgJLovazvvJsn6I6r5qy65bCR5bm056m3'
      ||       'J+aDhee7queahOaatOWKm+mHiuaUvu+8m+makOWMv+WunuWKm+WQjueahOmZjee7tOeivuWOi++8iOaJrueMquWQg+iZju+8iSIsImVzc2VuY2UiOiLpmLbl'
      ||       'sYLmgKjmsJTnmoTmt7HluqblrqPms4TkuI7npL7kvJrlnLDkvY3nmoTmmrTlipvmtJfniYzvvIzlrozmiJDku44n6KKr5Yml5aS66ICFJ+WIsCfop4TliJnl'
      ||       'iLblrprogIUn55qE5bCK5Lil6YeN5bu6IiwiY29uZmxpY3QiOiLml6flir/lipvmnYPotLXpmLblsYLlr7nlupXlsYLpqqTlr4zogIXnmoTlgrLmhaLkuI7o'
      ||       'tYTmupDlm7Tlib/vvJvlrrbml4/lhoXpg6jlir/liKnnnLzkuI7mi5zph5HlpbPnmoTliY3lkI7lj43lt67kuI7mrbvkuI3mgpTmlLnvvJvlpJrnu7Tluqbl'
      ||       'jovliLbvvIjotYTmnKzjgIHkurrohInjgIHmrablipvvvInkuI7kuLvop5LpmY3nu7TlpJbmjILkuYvpl7TnmoTmnoHoh7TnorDmkp7jgIIiLCJ0YWJvbyI6'
      ||       'IuS4peemgeWkluaMguiniemGkuWQjuS4u+inkuS+neeEtuWPl+awlOmakOW/jeOAgeW8uuihjOWOi+WItuWunuWKm++8m+S4peemgeWJjeacn+mTuuWeq+iZ'
      ||       'kOS4u+i/h+a3seWvvOiHtOeIveaEn+W7tui/n+WkquS5he+8iOivu+iAhea1geWkse+8ie+8m+S4peemgeWPjea0vuaypuS4uue6r+eyueeahOmZjeaZuuWk'
      ||       'jeivu+acuu+8jOWvvOiHtOaJk+iEuOe8uuS5j+WQq+mHkemHj+OAgiJ9LHsiaWQiOiJ0Yy0zOCIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IuenkeW5uyArIOac'
      ||       'q+S4liIsInRhZyI6IuenkeW5uyIsInN1YkdlbnJlcyI6IuenkeW5uyvmnKvkuJYiLCJsb2dpYyI6Iuacq+aXpeeBvuWPmO+8iOS4p+WwuOOAgeWkqeeBvuOA'
      ||       'geWkluaYn+WFpeS+te+8ieaRp+avgeS6uuexu+eOsOacieaWh+aYjuS4juS8pueQhuenqeW6jyDihpIg5Li76KeS5o6M5o6n6LaF6LaK5pe25Luj55qE56eR'
      ||       '5bm754Gr56eN77yI6buR56eR5oqA57O757uf44CB6auY57u06YG/6Zq+5omA44CB5Z+65Zug5Zu+6LCx77yJIOKGkiDkvp3miZjnp5HmioDpmY3nu7Tlr7nm'
      ||       'ipfmnKvkuJbngb7lj5jvvIzmmrTlipvnu5/lkIjlubjlrZjogIXvvIzpk7jlsLHmnKvkuJbmlrDnp6nluo8iLCJhdHRyYWN0aW9uIjoi5bqf5Zyf57ud5aKD'
      ||       '5Lit55qE5py65qKw56eR5oqA576O5a2m5LiO5a6J5YWo5oSf77yb5LuO6Zu254K55Lqu56eR5oqA5qCR55qE56eN55Sw5b+r5oSf77yb6ZKi6ZOB5rSq5rWB'
      ||       '5LiO5Y+Y5byC6KGA6IKJ55qE6KeG6KeJ5Yay5Ye777yb5LiA5Lq65bu656uL5pyr5pel5LmM5omY6YKm55qE6aKG6KKW5Y+y6K+X5oSfIiwiZXNzZW5jZSI6'
      ||       'IuaegeW6puWMruS5j+eOr+Wig+S4i+eahOeBq+WKm+S4jei2s+aBkOaDp+eXh+ayu+aEiO+8jOS7peWPiuS6uuexu+eQhuaAp+enkeaKgOaImOiDnOaXoOW6'
      ||       'j+eBvuWOhOeahOWuieWFqOaEn+WFkeeOsCIsImNvbmZsaWN0Ijoi5pyr5pel5Lq65oCn5omt5puy5LiL55qE5pq05b6S5o6g5aS66ICF5LiO5Li76KeS57ud'
      ||       '5a+556eR5oqA5aOB5Z6S55qE56Kw5pKe77yb5LiN5pat6L+b5YyW55qE5byC5pifL+WPmOW8gueUn+eJqeS4juenkeaKgOatpuWZqOeahOWGm+Wkh+ernui1'
      ||       'm++8m+acq+S4luaui+WtmOaXp+acieWumOaWueWKv+WKm+ivleWbvuaKouWkuuS4u+inkuenkeaKgOaIkOaenOeahOadg+WKm+WAvui9p+OAgiIsInRhYm9v'
      ||       'Ijoi5Lil56aB56eR5oqA5qCR5peg6YC76L6R6Lez6LeD5byP5pSA5Y2H77yI5aaC5peg5Z+656GA5bel5Lia55u05o6l5omL5pCT5py655Sy77yJ77yb5Lil'
      ||       '56aB5Li76KeS5YyW6Lqr5peg5bqV57q/5Zyj5q+N77yM5a+86Ie056eR5oqA6LWE5rqQ6KKr55m95auW77yb5Lil56aB5YWo56+H57y65LmP55Sf5a2Y5Y2x'
      ||       '5py65oSf77yM5bCG5pyr5LiW5YaZ5oiQ5peg6IGK55qE6YOK5ri456eN55Sw44CCIn0seyJpZCI6InRjLTQwIiwicmF0aW5nIjoiUyIsInRpdGxlIjoi56eR'
      ||       '5bm7ICsg57O757ufIiwidGFnIjoi56eR5bm7Iiwic3ViR2VucmVzIjoi56eR5bm7K+ezu+e7nyIsImxvZ2ljIjoi5bmz5Yeh5Li76KeS5oSP5aSW57uR5a6a'
      ||       '6auY57u05paH5piO5oiW5pyq5p2l6buR56eR5oqA5rS+5Y+R55qE57O757uf5aSW5oyCIOKGkiDpgJrov4fop6PmnpDku7vliqHkuI7mlLblibLnp5HmioDn'
      ||       'grnvvIzpgJDmraXop6PplIHotoXotorlvZPliY3ml7bku6PnmoTnoazmoLjnp5HmioDlm77nurjkuI7pgKDniakg4oaSIOS7juS9nOWdiui1t+atpe+8jOW7'
      ||       'uueri+aoqui3qOWFqOeQg+eahOenkeaKgOWehOaWreW4neWbve+8jOacgOe7iOW8lemihuWcsOeQg+aWh+aYjuWunueOsOaYn+mZhei3g+i/gSIsImF0dHJh'
      ||       'Y3Rpb24iOiLnp5HmioDmoJHnsr7lh4bngrnkuq7nmoTmlbDlgLzlj43ppojniL3mhJ/vvJvot6jml7bku6Ppu5Hnp5HmioDkuqflk4Hlj5HluIPkvJrluKbm'
      ||       'naXnmoTlhajnkIPpnIfmg4rvvIjkurrliY3mmL7lnKPvvInvvJvnp5HmioDpgKDnianku47ml6DliLDmnInlrp7njrDlt6XkuJrph4/kuqfnmoTliJvpgKDl'
      ||       'v6vmhJ/vvJvku6XmoLjlv4PmioDmnK/mjpDohJblrZDliLboo4HmtbflpJblt6jlpLTnmoTllYbkuJrnor7ljosiLCJlc3NlbmNlIjoi5oqA5pyv5Y2z5p2D'
      ||       '5Yqb55qE5p6B6Ie06K+g6YeK77yM6YCa6L+H6ZmN57u055+l6K+G6I635Y+W57ud5a+555qE5LiW55WM5pSv6YWN5p2DIiwiY29uZmxpY3QiOiLot6jlm73n'
      ||       'p5HmioDlt6jlpLQv6LaF57qn5aSn5Zu95a+55Li76KeS5paw6ZSQ56eR5oqA5YWs5Y+455qE5LiT5Yip57ue5p2A5LiO5ZWG5Lia6Ze06LCN5riX6YCP77yb'
      ||       '6buR56eR5oqA6Zeu5LiW5a+55Lyg57uf5Lqn5Lia6ZO+6YCg5oiQ55qE5q+B54Gt5oCn5Yay5Ye75LiO5pen5Yq/5Yqb55qE5Y+N5omR77yb6auY57u057O7'
      ||       '57uf6IOM5ZCO55qE56We56eY55uu55qE5LiO5Li76KeS6YCQ5q2l6KeJ6YaS55qE54us56uL5oSP5b+X5LmL6Ze055qE6ZqQ56eY5Lqk6ZSL44CCIiwidGFi'
      ||       'b28iOiLkuKXnpoHns7vnu5/lj5HluIPmirnmnYDmg6nnvZrmiJbku7vliqHov53og4zkuLvop5LmoLjlv4PliKnnm4rvvIjlj43lrqLkuLrkuLvvvInvvJvk'
      ||       'uKXnpoHns7vnu5/kuqflh7rnmoTnp5HmioDohLHohLHnprvnp5HlrabpgLvovpHmsqbkuLrnuq/nsrnnmoTnjoTlubvprZTms5XvvJvkuKXnpoHkuLvop5Lm'
      ||       'i7/liLDpu5Hnp5HmioDlkI7kvp3ml6fnlY/pppbnlY/lsL7vvIznvLrkuY/mjqjliqjmlofmmI7lj5jpnannmoTph47lv4PjgIIifSx7ImlkIjoidGMtNDEi'
      ||       'LCJyYXRpbmciOiJTIiwidGl0bGUiOiLnp5HlubsgKyDln7rlu7oiLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLnp5Hlubsr5Z+65bu6IiwibG9naWMi'
      ||       'OiLlvIDlsYDmjqXmiYvojZLoipzlup/lnJ/jgIHlup/lvIPmmJ/ljLrmiJblnLDkuIvpgb/pmr7miYDnrYnpm7bln7rnoYDpooblnLAg4oaSIOS+nemdoOeh'
      ||       'rOaguOenkeW5u+aKgOacr++8iOWmguiBmuWPmOiDvea6kOOAgee6s+exs+aZuumAoOOAgeWkquepuueUteair++8iemHjeWhkeW3peS4muavjeacuuS4jui1'
      ||       'hOa6kOW+queOr+S9k+ezuyDihpIg5ZC457qz5Lq65Y+j44CB57uE5bu65py65qKw5Yab5Zui77yM5bCG56C06LSl5LmL5Zyw5omT6YCg5oiQ5LiN5Y+v5pK8'
      ||       '5Yqo55qE5a6H5a6Z57qn56eR5oqA6KaB5aGeIiwiYXR0cmFjdGlvbiI6IuS7jumbtuWIsOS4gOaehOW7uuW3peS4mua1geawtOe6v+eahOWuj+Wkp+acuuai'
      ||       'sOe+juWtpu+8m+mihuWcsOi1hOa6kOS4juS6uuWPo+aVsOWAvOaMh+aVsOe6p+eIhuWFteWinumVv+eahOWFu+aIkOW/q+aEn++8m+mSoumTgeW3qOWFvemY'
      ||       'sue6v+aIkOWei+WQjueivuWOi+S4gOWIh+WFpeS+teiAheeahOWuieWFqOaEn++8m+WMlui6q+aYn+eQg+aEj+W/l+eahOmAoOeJqeS4u+S9k+mqjCIsImVz'
      ||       'c2VuY2UiOiLnp6nluo/lr7nmt7fkubHnmoTplYfljovvvIzku6Xlj4rlsIbojZLoipzovazljJbkuLrmnoHoh7Tlt6XkuJrnuYHojaPnmoTliJvpgKDmjozm'
      ||       'jqfmrLIiLCJjb25mbGljdCI6Iuaui+mFt+aegeerr+eahOWuh+WumS/lup/lnJ/njq/looPlpKnngb7lr7nohIblvLHliJ3mnJ/ln7rlu7rnmoTogIPpqozv'
      ||       'vJvmmJ/pmYXmtbfnm5fjgIHlvILmmJ/omavml4/miJbotKrlqarlhpvpmIDlr7nlr4zppbbpooblnLDnmoTnlq/ni4LlnoLmto7kuI7pmLLlvqHmiJjvvJvp'
      ||       'ooblnLDmgKXliafmianlvKDov4fnqIvkuK3kuqfnlJ/nmoTotYTmupDnk7bpoojkuI7kurrlj6Pnu5/lkIjnrqHnkIbljbHmnLrjgIIiLCJ0YWJvbyI6IuS4'
      ||       'peemgeaXoOinhuWfuuehgOW3peS4muS9k+ezu++8jOS4gOaLjeiEkemXqOebtOaOpeaJi+aQk+atvOaYn+iIsOetiee7iOaegemAoOeJqe+8m+S4peemgeWf'
      ||       'uuW7uui/h+eoi+aypuS4uuaer+eHpeeahOa1geawtOi0puaKpeihqO+8jOe8uuS5j+WklumDqOWKv+WKm+WIuua/gO+8m+S4peemgeS4u+inkuaJi+S4iy/p'
      ||       'oobmsJHmr6vml6Dlv6Dor5rluqbnlJroh7PovbvmmJPlgJLmiIjvvIznoLTlnY/ln7rlu7rmiJDlsLHmhJ/jgIIifSx7ImlkIjoidGMtNDYiLCJyYXRpbmci'
      ||       'OiJTIiwidGl0bGUiOiLmnKvkuJYgKyBBSSIsInRhZyI6IuenkeW5uyIsInN1YkdlbnJlcyI6Iuacq+S4litBSSIsImxvZ2ljIjoi5pyr5LiW6ZmN5Li056ep'
      ||       '5bqP5bSp5aGMIOKGkiDlrr/kuLvllKTphpIv57uR5a6a5YW35aSH6auY57u06Ieq5oiR6L+b5YyW6IO95Yqb55qE6LaF566XQUnkuK3mnqIg4oaSIEFJ5L6d'
      ||       '5omY5rW36YeP566X5Yqb44CB5YWo55+l6KeG6KeS5LiO5b6u6KeC5o6n5Yi26ZO+6Lev5o6l566h55Sf5a2Y5Z+65ZywIOKGkiDotYTmupDmnoHoh7TosIPp'
      ||       'hY3kuI7mnLrmorDlhpvlm6Loh6rliqjljJbmmrTlhbXmqKrmjqjlup/lnJ/ljbHmnLoiLCJhdHRyYWN0aW9uIjoi57ud5a+555CG5oCn55qE6Zu26K+v5beu'
      ||       '6L6F5Yqp5LiO5LiK5bid6KeG6KeS6aKE5YikIC8g566X5Yqb5rSq5rWB5YW36LGh5YyW5Li65py65qKw5Yab5Zui55qE5bqf5Zyf56K+5Y6LIC8g5Lq65py6'
      ||       '5rex5bqm5YWx55Sf55qE6Leo54mp56eN576B57uKIC8g56eR5oqA5Luj5beu5a+55Y+Y5byC55Sf54mp55qE5p6B5aKD6ZmN57u05omT5Ye7IiwiZXNzZW5j'
      ||       'ZSI6IuenqeW6j+W0qeWhjOeOr+Wig+S4i+eahOe7neWvueeQhuaAp+aOjOaOp+S4juehruWumuaAp+WuieWFqOaEnyIsImNvbmZsaWN0Ijoi5Lul4oCc566X'
      ||       '5Yqb5LiK6ZmQ5oyR5oiY4oCd5LiO4oCc6IO95rqQ5p6v56ut5Y2x5py64oCd5Li65qC45b+D6amx5Yqo44CC5Y+N5rS+5Y+v6K6+572u5Li65oul5pyJ5byC'
      ||       '5Y+Y57K+56We572R55qE6Jmr576k5Li76ISR44CB5YmN5paH5piO6YGX55WZ55qE5aSx5o6n5pm66IO977yM5oiW5LyB5Zu+5o6g5aS6QUnnn6npmLXnmoTm'
      ||       'rovlrZjkurrnsbvotKLpmIDjgILlhrLnqoHogZrnhKbkuo7ku6PnoIHlhaXkvrXlr7nmipfjgIHmnLrmorDmva7mtbfllbjpmLLnur/mlLvpmLLku6Xlj4rn'
      ||       'oazku7bljYfnuqfoioLngrnnmoTmnoHlr5LnianotYTkuonlpLrjgIIiLCJ0YWJvbyI6IuS4peemgUFJ5q+r5peg6YC76L6R5Zyw55Sf5Ye65Y+b6YCG5LmL'
      ||       '5b+D5oiW6KKr5L2O57u06aqH5a6i6ZmN5pm65aS65p2D77yb5Lil56aBQUnov4fluqbmi5/kurrljJblpLHljrvpq5jnu7Tnrpflipvnvo7mhJ/vvJvkuKXn'
      ||       'poHlv73op4ZBSeeul+WKm+aguOW/g+S4juehrOS7tui9veS9k+eahOeJqeeQhuWxgOmZkO+8jOWHuueOsOaImOWKm+S9k+ezu+aegeW6puWkseihoeOAgiJ9'
      ||       'LHsiaWQiOiJ0Yy00OCIsInJhdGluZyI6IlMiLCJ0aXRsZSI6IuWlh+W5uyArIOW8gueVjOWkp+mZhiIsInRhZyI6IuWlh+W5uyIsInN1YkdlbnJlcyI6IuWl'
      ||       'h+W5uyvlvILnlYzlpKfpmYYiLCJsb2dpYyI6IumrmOe7tOiupOefpeeBtemtgumZjeS4tOmtlOazlS/mlpfmsJTlvILnlYzniYjlm74g4oaSIOmAmui/h+eO'
      ||       'sOS7o+aAnee7tOmZjee7tOino+aekOW5tumHjeaehOW8gueVjOi2heWHoeazleWImeS9k+ezuyDihpIg5oub5Yuf6Leo56eN5peP6ZmE5bq45bm26L+b6KGM'
      ||       '6aKG5Zyf5byA6I2SIOKGkiDnvJTpgKDmqKrot6jlpKfpmYbnmoTlhajmlrDotoXlh6HmlofmmI7np6nluo8iLCJhdHRyYWN0aW9uIjoi546w5Luj5bel5Lia'
      ||       'L+WTsuWtpuaAnee7tOWvueWGt+WFteWZqOmtlOazleaWh+aYjueahOmZjee7tOaatOWHuyAvIOW6nuWkp+WPsuivl+e6p+S4lueVjOingueahOmAkOatpeeC'
      ||       'ueS6ruS4juaPreenmCAvIOeyvueBteWFveS6uuetieW8guerr+enjeaXj+eahOm6vuS4i+iHo+acjeS4juWPsuivl+WGm+WbouW7uuWItiAvIOaWh+aYjuei'
      ||       'vuWOi+W4puadpeeahOejheektOW+geacjeaEnyIsImVzc2VuY2UiOiLmlofmmI7ku6Plt67luKbmnaXnmoTkuIrluJ3op4bop5LkuI7nlobln5/lvoHmnI3n'
      ||       'moTlj7Lor5fmiJDlsLHmhJ8iLCJjb25mbGljdCI6IuWbtOe7leKAnOaXp+enqeW6j+aNjeWNq+iAheKAneS4juKAnOaWsOaWh+aYjuW8gOaLk+iAheKAneea'
      ||       'hOWtmOS6oeWNmuW8iOWxleW8gOOAguWvueaKl+WKv+WKm+WkmuS4uuWehOaWrei2heWHoei1hOa6kOeahOWPpOiAgeelnuauv+OAgeWGpemhveS4jeeBteea'
      ||       'hOW8guaXj+eOi+W6reaIluibsOS8j+S6jua3sea4iueahOi/nOWPpOmtlOelnuOAguWGsueqgeaguOW/g+WcqOS6juaWsOaXp+aAneaDs+eahOWJp+eDiOei'
      ||       'sOaSnuOAgeS/oeS7sOmihuWcsOeahOialemjn+S6ieWkuuS7peWPiueBreWbvee6p+mtlOazleemgeWSkueahOWvuei9sOOAgiIsInRhYm9vIjoi5Lil56aB'
      ||       '5Li76KeS6L+H5bqm5Zyj5q+N6KKr5Zyf6JGX5Yqj562J5paH5piO6YGT5b6357uR5p625oiW6IOM5Y+b77yb5Lil56aB5by66KGM6J6N5YWl5byC55WM5L2O'
      ||       '5pWI5L2T5Yi26ICM5oqb5byD56m/6LaK6ICF54us5pyJ55qE6K6k55+l57qi5Yip77yb5Lil56aB6K6+5a6a5peg5bqP6Iao6IOA5a+86Ie05LiW55WM6KeC'
      ||       '5LiO6LaF5Yeh5oiY5Yqb5Y+M6YeN5bSp5Z2P44CCIn0seyJpZCI6InRjLTUxIiwicmF0aW5nIjoiUyIsInRpdGxlIjoi546E5bm7ICsg57O757ufIiwidGFn'
      ||       'Ijoi546E5bm7Iiwic3ViR2VucmVzIjoi546E5bm7K+ezu+e7nyIsImxvZ2ljIjoi5Yeh6aqo5Li76KeS5Yqg6L295qaC5b+157qn546E5bm757O757uf5byV'
      ||       '5pOO77yI5aaC5LiA6ZSu5ruh57qn44CB5Lq/5LiH5YCN6L+U6L+Y77yJIOKGkiDlgJ/nlLHmqKHlnZfljJblip/og73vvIjmjILmnLov5oq95aWWL+e7keWu'
      ||       'mu+8ieWunueOsOWkp+ixoeaXoOW9oueahOaegemAn+aOoOWkuiDihpIg5Lul6auY57u06LWE5rqQ5bqV6JW05LiO6LaF6KeE5qC85oiY5Yqb6ZmN57u056K+'
      ||       '5Y6L5Zyj5Zyw6YGT57uf5LiO5rCU6L+Q5LmL5a2QIiwiYXR0cmFjdGlvbiI6IuWPjeWll+i3r+egtOWig+W4puadpeeahOS4nea7keaOqOWbvueIveaEnyAv'
      ||       'IOamguW/tee6p+WkluaMguWvueS8oOe7n+iLpuS/ruS9k+ezu+eahOaXoOaDheWYsuW8hCAvIOi9u+advuaUvue9ruS4juaegeiHtOaatOWKm+eahOWPjeW3'
      ||       'ruiQjCAvIOmaj+W/g+aJgOassuiwg+WPluS4h+eVjOelnueJqeeahOaatOWPkeaIt+W/q+aEnyIsImVzc2VuY2UiOiLlvbvlupXliaXnprvliqrlipvmiJDm'
      ||       'nKznmoTnuq/nsrnml6DmlYzmhJ/kuI7pq5jpopHlpJrlt7Tog7rlpZbotY8iLCJjb25mbGljdCI6IuWGsueqgeeahOaguOW/g+WcqOS6juKAnOS4jeiusueQ'
      ||       'hueahOWkluaMguS9k+ezu+KAneWvueaSnuKAnOaguea3seiSguWbuueahOS/ruS7meW4uOeQhuKAneOAguWvueeri+mdouWkmuS4uuiHquWRveS4jeWHoeea'
      ||       'hOS4iueVjOS7meS9v+OAgeS7peWkqeWcsOS4uuWxgOeahOi/nOWPpOmtlOWwiuaIluWQjOaLpemHkeaJi+aMh+eahOS9jumFjeeJiOWkqeWRveS5i+WtkOOA'
      ||       'guS6pOmUi+WcuuaZr+WkmuS4uuenmOWig+WkuuWuneaXtuS7peS4gOaVjOeZvueahOaXoOWPjOS5seiInuOAgeaXoOinhumYteazleemgeWItuW8uuWQg+Wu'
      ||       'l+mXqOW6leiVtOeahOaOoOWkuuaImO+8jOS7peWPiuS4gOaLs+i9sOeijuaVjOaWueaVsOWNg+W5tOaKpOWul+Wkp+mYteeahOaatOWKm+e+juWtpuWxleek'
      ||       'uuOAgiIsInRhYm9vIjoi5Lil56aB57O757uf5Y+R5biD5oaL5bGI55qE6ZqQ5b+N5Lu75Yqh5oiW6K6+5a6a6Iub5Yi755qE5aSx6LSl5oOp572a77yb5Lil'
      ||       '56aB5Li76KeS6I635Y+W6YCG5aSp5aSW5oyC5ZCO5L6d54S26LCo5bCP5oWO5b6u5aaC5bGl6JaE5Yaw77yb5Lil56aB5aWW5Yqx6YGT5YW35o+P6L+w5rWu'
      ||       '5aS45L2G5a6e5oiY5pWI5p6c5p6B5YW25ouJ6IOv77yM6Ie05L2/5oiY5Yqb5bSp55uY44CCIn0seyJpZCI6InRjLTU0IiwicmF0aW5nIjoiUyIsInRpdGxl'
      ||       'Ijoi5ZWG5oiYICsg6YO95biCIiwidGFnIjoi6YO95biCIiwic3ViR2VucmVzIjoi5ZWG5oiYK+mDveW4giIsImxvZ2ljIjoi5r2c5YWl5pqX5rWB5raM5Yqo'
      ||       '55qE6auY5YeA5YC86YO95biC5ZWG5ZyI5Y+R6L2rIOKGkiDnm7TpnaLlnLDlpLTom4fotKLpmIDkuI7lm73pmYXmuLjotYTnmoTmgbbmgKflgL7plIDkuI7o'
      ||       'tYTmnKznu57mnYAg4oaSIOi/kOeUqOaegeiHtOeahOmHkeiejeadoOadhuOAgeS/oeaBr+WJquWIgOW3ruS4juelnue6p+WFrOWFs+mYs+iwi+mAhuWKv+WB'
      ||       'muWxgCDihpIg5q2l5q2l6JqV6aOf5a+55omL54mI5Zu+77yM5pyA57uI6YeN5aGR6YO95biC57uP5rWO5qC85bGA5bm255m76aG25a+h5aS0546L5bqnIiwi'
      ||       'YXR0cmFjdGlvbiI6IumrmOaZuuWVhuWvueWGs+S4reeahOi/nueOr+iuoeS4reiuoeS4juinhOWImeWPjeadgCAvIOaegemZkOWBmuepuuS4juadoOadhuaU'
      ||       'tui0reW4puadpeeahOiCvuS4iuiFuue0oOmjmeWNhyAvIOS7juiNieagueWIsOaTjeebmOeZvuS6v+ebmOWPo+Wkp+S9rOeahOaegeiHtOi6q+S7veiQveW3'
      ||       'riAvIOe/u+aJi+S4uuS6keimhuaJi+S4uumbqOeahOi1hOacrOaatOaUv+aTjeaOp+aEnyIsImVzc2VuY2UiOiLnjrDku6PotKLlr4zop4TliJnkuIvnmoTp'
      ||       'mY3nu7TmmbrllYbnor7ljovkuI7ot6jotorpmLblsYLnmoTph5HpkrHmnYPlipvmk43mjqfmhJ8iLCJjb25mbGljdCI6IuWbtOe7leKAnOaciemZkOeahOW4'
      ||       'guWcuuS7vemineKAneS4juKAnOaXoOWwveeahOi1hOacrOi0quassuKAneaehOW7uuWvueaImOOAguaVjOWvuemYteiQpeWMheaLrOiAgeiwi+a3seeul+ea'
      ||       'hOeZvuW5tOWutuaXj+aOjOiIteS6uuOAgeWGt+mFt+aXoOaDheeahOaKleihjOWkp+mzhOaIluS8geWbvuevoeadg+WkuuS9jeeahOWFrOWPuOS6jOaKiuaJ'
      ||       'i+OAguaguOW/g+WGsueqgeeIhuWPkeeCueWcqOS6juaBtuaEj+aUtui0reaImOS4reeahOaal+ebmOWQuOetueOAgeiIhuiuuuWNseacuuWFrOWFs+aXtuea'
      ||       'hOeUn+atu+aXtumAn+WPjei9rO+8jOS7peWPiuiRo+S6i+S8muS4iuWFteS4jeihgOWIg+WNtOWtl+Wtl+ivm+W/g+eahOaOp+WItuadg+e9ouWFjeWvueWG'
      ||       's+OAgiIsInRhYm9vIjoi5Lil56aB5bCG5ZWG5oiY6ZmN5qC85Li64oCc6buR6YGT5Y+k5oOR5LuU4oCd5byP55qE54mp55CG54Gr5ou85LiO5L2O57qn6ZuH'
      ||       '5Ye25Lyk5Lq677yb5Lil56aB5Li76KeS5Y+q5oeC5peg6ISR56C46ZKx6ICM57y65LmP6auY5piO5ZWG5Lia5omL6IWV77yb5Lil56aB5ZWG5Lia6YC76L6R'
      ||       '5Lil6YeN5Y+N5pm677yM5aaC5Y2D5Lq/6ZuG5Zui6ICB5oC75q+P5aSp5Lqy6Ieq5Yqo5omL5bmy5L+d5a6J55qE5rS7562J6ISx56a7546w5a6e55qE6I2S'
      ||       '6K+e5qGl5q6144CCIn0seyJpZCI6InRjLTUiLCJyYXRpbmciOiJBIiwidGl0bGUiOiLpg73luIIgKyDpmpDol4/ouqvku70iLCJ0YWciOiLpg73luIIiLCJz'
      ||       'dWJHZW5yZXMiOiLlup/mn7Qr6ZqQ6JeP6Lqr5Lu9IiwibG9naWMiOiLnpL7kvJrpmLblsYLop4bop4nnrKblj7fnmoTliLvmhI/kvKroo4Ug4oaSIOaJv+WP'
      ||       'l+WIu+adv+WNsOixoeW4puadpeeahOi0rOS9juWOi+aKkSDihpIg6Lqr5Lu96Kej5p6E54iG5Y+R5bim5p2l55qE5by654OI5oOF57uq5Y+N5by5IiwiYXR0'
      ||       'cmFjdGlvbiI6IuaegeiHtOeahOi6q+S7veiQveW3ruWItumAoOeahOaIj+WJp+W8oOWKmyAvIOaJrueMquWQg+iZjueahOe7neWcsOWPjeWHu+aJk+iEuCAv'
      ||       'IOi6q+S7veaPreaZk+eerOmXtOaXgeS6uueahOmch+aDiuS4juaVrOeVjyIsImVzc2VuY2UiOiLlnKjljovmipHkuI7ph4rmlL7nmoTmnoHnq6/mi4nmia/k'
      ||       'uK3kvZPpqozmnYPlipvkuIvljovnmoTlv6vmhJ8iLCJjb25mbGljdCI6IuWcqOS4jeW+l+S4jeWxleeOsOWunuWKm+S4jue7tOaMgeS8quijheS5i+mXtOea'
      ||       'hOaegemZkOaLieaJr+OAgeS6sui/keS5i+S6uueahOivleaOouS4juivr+ino+WNh+e6p+OAgeecn+ato+eahOWQjOmHj+e6p+WPjea0vuWboOS4jeefpeaD'
      ||       'heiAjOS6p+eUn+eahOatu+S6oeWogeiDgeOAgiIsInRhYm9vIjoi5Lil56aB6ZqQ6JeP6Lqr5Lu955qE5Yid5aeL5Yqo5py65p6B5bqm6IuN55m95peg6ISR'
      ||       '77yI5aaC57qv6Ieq6JmQ5rGC6YSZ6KeG77yJ77yb5Lil56aB5pud5YWJ6Lqr5Lu95ZCO5ZGo6L6556S+5Lya5YWz57O75q+r5peg5Y+N5bqU77yM57y65LmP'
      ||       '6Zi257qn5Y+N5Ye755qE6YeN5Yqb5oSf5LiO54i954K55Zue5pS244CCIn0seyJpZCI6InRjLTEyIiwicmF0aW5nIjoiQSIsInRpdGxlIjoi5peg6ZmQ5rWB'
      ||       'ICsg5qih5ouf5ZmoIiwidGFnIjoi56eR5bm7Iiwic3ViR2VucmVzIjoi5qih5ouf5ZmoK+S6uueUn+mHjeW8gCIsImxvZ2ljIjoi56m35Li+5byP6K+V6ZSZ'
      ||       '57Sv56ev5bqV5bGC5oOF5oqlIOKGkiDlpJrliIbmlK/ml7bnqbrnur/ntKLmlLbmnZ8g4oaSIOeOsOWunuS4lueVjOWUr+S4gOWujOe+jumAmuWFs+OAgiIs'
      ||       'ImF0dHJhY3Rpb24iOiLml6DpmZDor5XplJnluKbmnaXnmoTpm7bmiJDmnKzmrbvkuqHkvZPpqozvvIzonbTonbbmlYjlupToiKznmoTlkb3ov5Dovajov7nm'
      ||       'vJTnrpfvvIzku6Xlj4rmnIDnu4jlnKjnjrDlrp7kuK3lhajnn6Xlhajog73nmoTpmY3nu7TmiZPlh7vjgIIiLCJlc3NlbmNlIjoi5L+h5oGv5beu56m35Li+'
      ||       '5LiO5ZG96L+Q6L2o6L+555qE56Gu5a6a5oCn5pS25p2f77yI5a6M576O5YWo5Zu+6Ym05pS26ZuG77yJ44CCIiwiY29uZmxpY3QiOiLmqKHmi5/lmajlm7rm'
      ||       'nInnmoTlhrfljbTpmZDliLbkuI7njrDlrp7nqoHlj5HljbHmnLrnmoTml7bpl7TotZvot5HjgIHotoXmqKHlrZjlnKjnmoTop4TliJnlj43lmazjgIHlkb3o'
      ||       'v5DmlLbmnZ/ngrnkuIrkuI3lj6/mjqfnmoTlj5jph4/lubLmtonjgIIiLCJ0YWJvbyI6IuS4peemgemAmuWFs+WFs+mUrue6v+e0oueUseS4u+inkuWFqOWH'
      ||       'reeOhOWtpuaEn+aCn+W+l+WHuuiAjOaXoOmAu+i+keaOqOeQhuaUr+aSke+8m+S4peemgeWJr+acrOinhOWImeWJjeWQjuWGsueqgeWvvOiHtOatu+e7k+W0'
      ||       'qea6g+aXoOino++8m+S4peemgeaooeaLn+i/h+eoi+W9u+W6leawtOWtl+aVsOiAjOWJpeemu+S6huaCrOW/teaEn+OAgiJ9LHsiaWQiOiJ0Yy0xNCIsInJh'
      ||       'dGluZyI6IkEiLCJ0aXRsZSI6IuS7meS+oCArIOezu+e7nyIsInRhZyI6IuS7meS+oCIsInN1YkdlbnJlcyI6IuS/ruS7mSvns7vnu58iLCJsb2dpYyI6IueO'
      ||       'hOWtpuS/ruecn+WjgeWekuegtOmZpCDihpIg6L+b5bqm5p2hL+S7u+WKoeWMlumpseWKqOeahOehruWumuaAp+aIkOmVvyDihpIg6LaF6LaK5L2N6Z2i5rOV'
      ||       '5YiZ55qE5peg55O26aKI6aOe5Y2H44CCIiwiYXR0cmFjdGlvbiI6Iua2iOmZpOS/ruS7meW4puadpeeahOS4jeehruWumuaAp++8jOWwhuiZmuaXoOe8pee8'
      ||       'iOeahOmhv+aCn+WSjOeBteaguei9rOWMluS4uuWPr+inhuWMlueahOi/m+W6puadoe+8jOS6q+WPl+S7mOWHuuWNs+acieWbnuaKpeeahOaegemAn+aIkOmV'
      ||       'v+WPjemmiOOAgiIsImVzc2VuY2UiOiLmtojpmaTkuI3noa7lrprmgKfluKbmnaXnmoTmnoHoh7TlronlhajmhJ/kuI7mlbDmja7ohqjog4DnmoTniL3mhJ/j'
      ||       'gIIiLCJjb25mbGljdCI6Iuezu+e7n+S7u+WKoeimgeaxguS4juS/ruS7meeVjOaui+mFt+azleWImeS5i+mXtOeahOmBk+W+ty/nlJ/lrZjlhrLnqoHjgIHn'
      ||       's7vnu5/pooHlj5HnmoTkvZzmrbvku7vliqHluKbmnaXnmoTljbHmnLrlupTlr7njgIHlrr/kuLvouqvku73kuI7kv67ku5nnlYzmnKzlnJ/lpKfog73nmoTo'
      ||       'r5XmjqLljZrlvIjjgIIiLCJ0YWJvbyI6IuS4peemgeezu+e7n+W8uuihjOaUr+mFjeS4u+inkuaEj+W/l++8iOWWp+WuvuWkuuS4u++8ie+8m+S4peemgeez'
      ||       'u+e7n+aVsOWAvOmAmuiDgOWkseaOp+WvvOiHtOaImOWKm+W0qeWdj++8m+S4peemgeezu+e7n+ebtOaOpeWPkeaUvuaXoOaVjOWlluWKseiAjOS4p+Wksei/'
      ||       'h+eoi+eIveaEn+OAgiJ9LHsiaWQiOiJ0Yy0yMiIsInJhdGluZyI6IkEiLCJ0aXRsZSI6IuWGm+S6iyArIOezu+e7nyIsInRhZyI6IuWGm+S6iyIsInN1Ykdl'
      ||       'bnJlcyI6IuWGm+S6iyvns7vnu58iLCJsb2dpYyI6IuWwhuihgOiCieaoqumjnueahOaui+mFt+aImOWcuui9rOWMluS4uuWPr+inhuWMlueahOezu+e7n+aV'
      ||       'sOaNrumdouadvyDihpIg6YCa6L+H5a6M5oiQ5Yab5LqL5Lu75Yqh5oiW5p2A5pWM6I635Y+W6LWE5rqQIOKGkiDlhZHmjaLlhYjov5voo4XlpIfjgIHljYfn'
      ||       'uqflhbXnp43mqKHmnb/jgIHop6PplIHpq5jnuqfmiJjmnK/lhYnnjq/vvIzmu5rpm6rnkIPlvI/lo67lpKflrp7lipvjgIIiLCJhdHRyYWN0aW9uIjoi5riF'
      ||       '5pmw5Y+v6KeB55qE5p2A5pWM5pS255uK5LiO5q2j5Y+N6aaI5b6q546v77yb5LiA5Lq65oiQ5Yab5oiW5bim6aKG5p2C54mM5Yab6YCG6KKt546L54mM6YOo'
      ||       '6Zif55qE5YW75oiQ5b+r5oSf77yb57O757uf5aWW5Yqx55uy55uS5bim5p2l55qE6LWM5Y2a5byP5pyf5b6F44CCIiwiZXNzZW5jZSI6IuadgOaIruWPmOeO'
      ||       'sOeahOaUtuebiuaegeiHtOWMluS4juWNs+aXtuato+WQkeWPjemmiOOAgiIsImNvbmZsaWN0Ijoi57O757uf5Lu75Yqh55qE5p6B56uv6Iub5Yi76KaB5rGC'
      ||       '5LiO5oG25Yqj5oiY5Zy6546v5aKD5LmL6Ze055qE5Yay56qB77yb5Li76KeS6ZqQ6JeP57O757uf56eY5a+G5LiO6auY5bGC5a+55YW26LaF5by66IO95Yqb'
      ||       '55qE5b+M5oOu5Y+K6LCD5p+l77yb6YGt6YGH5bGe5oCn5ZCM5qC35oOK5Lq677yI6Jm95peg57O757uf5L2G5pyJ5p6B56uv5aSp6LWL77yJ55qE546L54mM'
      ||       '5a6/5pWM5oiW54m556eN5bCP6Zif44CCIiwidGFib28iOiLkuKXnpoHns7vnu5/lhZHmjaLniannoLTlnY/lvZPliY3lhpvkuovkvY3pnaLnmoTln7rnoYDl'
      ||       'ubPooaHvvIjlpoLkuIDmiJjlh7rnjrDmrbzmmJ/oiLDvvInvvJvkuKXnpoHns7vnu5/mlbDlgLzpgJrotKfohqjog4Dov4flv6vvvIzlr7zoh7TlkI7mnJ/m'
      ||       'sqbkuLrmr6vml6DmhI/kuYnnmoTmlbDlrZfloIbnoIzvvJvkuKXnpoHmirnmnYDmiJjkuonnmoTkuKXogoPmgKfvvIzlsIblo6vlhbXlrozlhajop4bkvZzm'
      ||       'l6DmhJ/mg4XnmoROUEPjgIIifSx7ImlkIjoidGMtMjUiLCJyYXRpbmciOiJBIiwidGl0bGUiOiLlhpvkuosgKyDmmJ/pmYXmiJjkuokiLCJ0YWciOiLlhpvk'
      ||       'uosiLCJzdWJHZW5yZXMiOiLlhpvkuosr5pif6ZmF5oiY5LqJIiwibG9naWMiOiLnqoHnoLTlnLDmnIjns7vmnZ/nvJrotbDlkJHmt7Hnqbog4oaSIOaehOW7'
      ||       'uuW6nuWkp+eahOaYn+mZheiIsOmYn+S4juWkmue7tOepuumXtOaImOacr+S9k+ezuyDihpIg5Zyo6buR5pqX5qOu5p6X5oiW5aSa5YWD5a6H5a6Z5paH5piO'
      ||       '5Y2a5byI5Lit77yM6L+b6KGM5YWJ5bm05bC65bqm55qE5a6P5aSn5q2854Gt5oiY5LiO6LWE5rqQ5o6g5aS644CCIiwiYXR0cmFjdGlvbiI6IuW3qOiIsOWk'
      ||       'p+eCruWcqOa3semCg+aYn+a1t+S4rem9kOWwhOeahOe7iOaegeWuj+Wkp+WPmeS6i+S4juinhuinieWlh+ingu+8m+i3qOi2iue7tOW6pueahOmZjee7tOaJ'
      ||       'k+WHu++8iOWmguS6jOWQkeeulOOAgeWFieeyku+8ieW4puadpeeahOa3seWxgumch+aSvO+8m+S6uuexu+aWh+aYjuWcqOa1qeeAmuWuh+WumeS4reW8gOeW'
      ||       'huaLk+Wcn+eahOWPsuivl+aEn+OAgiIsImVzc2VuY2UiOiLlr7nlub/ooqTmnKrnn6XlroflrpnnmoTlvoHmnI3mrLLkuI7lt6jnianmgZDmg6cv5bSH5ouc'
      ||       '55qE5p2C57OF5L2T6aqM44CCIiwiY29uZmxpY3QiOiLkuI3lkIznorPln7ov56GF5Z+65paH5piO5LmL6Ze05Zug55Sf5a2Y5rOV5YiZ5LiO5bqV5bGC6YC7'
      ||       '6L6R5beu5byC5bim5p2l55qE5LiN5Y+v6LCD5ZKM5LmL5oiY77yb6Iiw6Zif6LeD6L+B5Lit6YGt6YGH5byV5Yqb6Zm36Zix44CB5a6H5a6Z6aOO5pq0562J'
      ||       '5p6B56uv5aSp5L2T54G+6Zq+55qE5p6B6ZmQ6Ieq5pWR77yb5oiY57q/5ouJ6ZW/5ZCO5q+N5pif5aSn5pys6JCl5LiO6L+c5b6B6Iiw6Zif5LmL6Ze055qE'
      ||       '5pS/5rK76KOC55eV5LiO6KGl57uZ55Sf5ZG957q/5L+d5Y2r5oiY44CCIiwidGFib28iOiLkuKXnpoHlnKjlhYnlubTlsLrluqbnmoTmiJjlnLrkuIrkvb/n'
      ||       'lKjlpKfliIDplb/nn5vlvI/miJbmjpLpmJ/mnqrmr5nlvI/nmoTkvY7lubzmiJjmnK/vvJvkuKXnpoHml6Dop4bln7rnoYDlpKnkvZPniannkIbop4Tlvovv'
      ||       'vIjlpoLph43lipvjgIHnnJ/nqbrjgIHlhYnpgJ/lu7bov5/vvInlvLrooYzlpZfnlKjmtbfmiJjpgLvovpHvvJvkuKXnpoHlpJbmmJ/mlofmmI7ooqvliLvn'
      ||       'lLvmiJDlj6rkvJrmtYHlj6PmsLTnmoTkurrlvaLph47lhb3vvIjnvLrkuY/mlofmmI7lupXlsYLlu7rmnoTvvInjgIIifSx7ImlkIjoidGMtNDIiLCJyYXRp'
      ||       'bmciOiJBIiwidGl0bGUiOiLnp5HlubsgKyDpg73luIIiLCJ0YWciOiLnp5HlubsiLCJzdWJHZW5yZXMiOiLnp5Hlubsr6YO95biCIiwibG9naWMiOiLpmpDo'
      ||       'l4/kuo7nuYHljY7pg73luILkuK3nmoTovrnnvJjkurrvvIjlrp7kuLrmjozmjqfpq5jnu7Tnp5HmioDjgIHns7vnu5/miJbmnKrmnaXmlofmmI7pgZfkuqfn'
      ||       'moTpobblsJbpu5HlrqIv56eR5a2m5a6277yJIOKGkiDlsIbpmY3nu7Tnp5HmioDpmY3nuqfkuLrpoqDopobmgKfmsJHnlKjkuqflk4HvvIjlpoLmsrvmhIjn'
      ||       'u53nl4fjgIHnnJ/lhajmga/jgIHlj6/mjqfmoLjogZrlj5jvvInmipXlhaXluILlnLog4oaSIOS7pee7neWvueeahOaKgOacr+WjgeWekuaSleijguaXp+ac'
      ||       'iei0oumYgOWehOaWre+8jOW8leeIhuWFqOeQg+agvOWxgOa0l+eJjCIsImF0dHJhY3Rpb24iOiLml6XluLjpg73luILog4zmma/kuIvpu5Hnp5HmioDnqoHp'
      ||       'mY3luKbmnaXnmoTnnJ/lrp7pnIfmkrzmhJ/kuI7or53popjluqbvvJvpmY3nu7TmioDmnK/kuqflk4HmmrTliKnnor7ljovkvKDnu5/otYTmnKznmoTniL3m'
      ||       'hJ/vvJvnp5HmioDliIflrp7mlLnlj5jlhajkurrnsbvnlJ/mtLvlubbojrflvpfkuIfkvJfni4Lng63ohpzmi5znmoTojaPogIDmhJ/vvJvmiJDkuLrlm73l'
      ||       'rrbnuqfkuYPoh7PkuJbnlYznuqfmiJjnlaXlupXniYznmoTotoXnhLblnLDkvY0iLCJlc3NlbmNlIjoi5Lul56eR5oqA6Zy45p2D5Luj5pu/6LWE5pys6Zy4'
      ||       '5p2D77yM5a6e546w5LuO5Yeh5Lq65Yiw546w5Luj56S+5LyaJ+aKgOacr+elnuaYjifnmoTpmLblsYLkuI7mnYPlipvot4PljYciLCJjb25mbGljdCI6Iui3'
      ||       'qOWbvei1hOacrOW3qOmzhOmdouWvueaguOW/g+WIqeebiuiiq+mioOimhuaXtueahOeWr+eLguWPjeaJkeS4juS4i+S9nOaJi+aute+8iOaal+adgOOAgeWI'
      ||       'tuijge+8ie+8m+awkeeUqOenkeaKgOS6p+WTgeaOqOWQkeWFqOeQg+aXtumBremBh+eahOaWh+WMluWjgeWekuS4juaKgOacr+WwgemUge+8m+WbveWutuac'
      ||       'uuWZqOeahOivleaOouS4juWQiOS9nOWNmuW8iOS4reWmguS9leS/neaMgeS4u+inkueahOe7neWvueiHquS4u+adg+OAgiIsInRhYm9vIjoi5Lil56aB6auY'
      ||       '56eR5oqA5oiQ5p6c6KKr6ZmN5pm65LqM5Luj5oiW5Zyw5pa55oG26Zy45by66KGM5oqi5aS66ICM5Li76KeS5peg5Yqb5Y+N5Yi277yI5oaL5bGI77yJ77yb'
      ||       '5Lil56aB5bCG56Gs5qC455qE56eR5oqA56K+5Y6L5YaZ5oiQ5oqr552A56eR5bm755qu55qE54uX6KGA6LGq6Zeo5oGL54ix5Ymn77yb5Lil56aB56eR5oqA'
      ||       '56CU5Y+R6ISx56a7546w5a6e55eb54K577yM5a+86Ie06K+76ICF57y65LmP5Luj5YWl5oSf44CCIn0seyJpZCI6InRjLTEwIiwicmF0aW5nIjoiQiIsInRp'
      ||       'dGxlIjoi5ZWG5oiYICsg6YeN55SfIiwidGFnIjoi6YO95biCIiwic3ViR2VucmVzIjoi6YeN55SfK+WVhuaImC/np5HmioAiLCJsb2dpYyI6IuS/oeaBr+mZ'
      ||       'jee7tOaJk+WHuyDihpIg5YmN55675oCn6LWE5rqQ5Z6E5patIOKGkiDlu7rnq4vml7bku6PnuqfllYbkuJrluJ3lm70iLCJhdHRyYWN0aW9uIjoi5Yip55So'
      ||       '5pe25Luj57qi5Yip6L+b6KGM57K+5YeG5Y2h5L2N77yM6YCa6L+H5YWI55+l5YWI6KeJ5a6e546w6LWE5pys55qE5pq05Yip5rua6Zuq55CD77yM5a+55ZCM'
      ||       '5Luj57K+6Iux5b2i5oiQ6ZmN57u056K+5Y6L44CCIiwiZXNzZW5jZSI6IuWvueWRvei/kOi9qOi/ueeahOW8uuaOjOaOp+aEn+S4juaXtuS7o+e6ouWIqeea'
      ||       'hOWFt+ixoeWMluaUtuWJsuOAgiIsImNvbmZsaWN0Ijoi5pen5pyJ5Yip55uK6ZuG5Zui55qE5Y+N5omR44CB6LWE5pys56ev57Sv5pyf55qE5Y6f5aeL6LWE'
      ||       '5rqQ5LqJ5aS644CB5oqA5pyv5LiO5biC5Zy65ouT5bGV5Lit55qE56ue5LqJ5aOB5Z6S56qB56C044CCIiwidGFib28iOiLkuKXnpoHllYbkuJrov5DkvZzo'
      ||       'v53og4zln7rmnKznu4/mtY7op4TlvovvvJvkuKXnpoHlr7nmiYvlvLrooYzpmY3mmbrnmb3nu5nlr7zoh7TljZrlvIjmhJ/mtojlpLHvvJvkuKXnpoHnqbrm'
      ||       'tJ7nmoTlro/lpKflj5nkuovogIznvLrkuY/nu4boioLokL3lnLDnmoTllYbkuJrlrp7mk43jgIIifSx7ImlkIjoidGMtMTYiLCJyYXRpbmciOiJCIiwidGl0'
      ||       'bGUiOiLku5nkvqAgKyDlrpfpl6jnu4/okKUiLCJ0YWciOiLku5nkvqAiLCJzdWJHZW5yZXMiOiLkv67ku5kr5a6X6Zeo57uP6JClIiwibG9naWMiOiLkuKrk'
      ||       'urrmiJjlipvkuLrln7rngrkg4oaSIOW7uueri+WIqeebiuS/ruS7meWFseWQjOS9kyDihpIg5Lqn5Lia5Y2H57qn5LiO5ZCe5bm25a6e546w5YWo5a6X6Zeo'
      ||       '5rCU6L+Q6aOe6LeD44CCIiwiYXR0cmFjdGlvbiI6IuS7jumbtuW8gOWni+e7hOW7uuaetuaehOeahOenjeeUsOWFu+aIkOW/q+aEn+OAgeW8n+WtkOWkqemq'
      ||       'hOaIkOaJjeWQjueahOWPjeWTuuS4jue+pOWDj+WhkemAoOOAgeWkp+WKv+WKm+WvueWGs+W4puadpeeahOWuj+inguWPsuivl+aEn+OAgiIsImVzc2VuY2Ui'
      ||       'OiLnvqTkvZPlhbvmiJDkuI7nu4Tnu4flipvlj5jnjrDluKbmnaXnmoTnu5/msrvpmLbnuqflv6vmhJ/jgIIiLCJjb25mbGljdCI6IuS/ruS7meeVjOWtmOmH'
      ||       'j+i1hOa6kOS6ieWkuuS4i+eahOWul+mXqOWAvui9p+OAgeWGhemDqOa0vuezu+WIqeebiuWIhumFjeS4juWPm+Wul+WNseacuuOAgeS4iuS9jeWul+mXqOea'
      ||       'hOmZjee7tOaJk+WOi+S4jumZhOWxnuWul+mXqOeahOiDjOWIuuOAgiIsInRhYm9vIjoi5Lil56aB5byf5a2Q5q+r5peg55CG55Sx55qE4oCc57qv5q275b+g'
      ||       '4oCd77yI5peg5oOF5oSf5oiW5Yip55uK57q95bim57uR5a6a77yJ77yb5Lil56aB5L+u5LuZ55WM54G155+z5LiO5Li56I2v5Ye6546w6L+H5bqm6YCa6IOA'
      ||       '6ISx56a75a6X6Zeo5pS25pSv6Zet546v77yb5Lil56aB5Li76KeS5b275bqV5rKm5Li65L+d5aeG6ICM5aSx5Y675Liq5Lq65oiQ6ZW/55qE6a2F5Yqb44CC'
      ||       'In0seyJpZCI6InRjLTIzIiwicmF0aW5nIjoiQyIsInRpdGxlIjoi5Yab5LqLICsg5Z+65bu6IiwidGFnIjoi5Yab5LqLIiwic3ViR2VucmVzIjoi5Yab5LqL'
      ||       'K+WfuuW7uiIsImxvZ2ljIjoi5LuO5LiA56m35LqM55m955qE5oiY5Lmx6I2S5Zyw6LW35q2lIOKGkiDmlIDnmbvlt6XkuJrmoJHjgIHlu7rorr7lhpvlt6Xk'
      ||       'uqfkuJrpk77kuI7lkI7li6Tkv53pmpzkvZPns7sg4oaSIOWwhuWfuuW7uui9rOWMluS4uuaImOS6iea9nOWKm++8jOacgOe7iOS7peejheektOeahOW3peS4'
      ||       'muWJquWIgOW3ruS4juS6p+iDvea0qua1geaOqOW5s+aVjOS6uuOAgiIsImF0dHJhY3Rpb24iOiLku47ml6DliLDmnInlu7rnq4vlhpvlt6XluJ3lm73nmoTn'
      ||       'p43nlLDlhbvmiJDlv6vmhJ/vvJvpkqLpk4HmtKrmtYHkuI7lpKfngq7lt6joiLDkuIvppbrlrZDoiKzkuIvmsLTnmoTnoazmoLjmtarmvKvvvJvku6Xlt6Xk'
      ||       'uJrljJbkvZPns7vnor7ljovmiYvlt6XkvZzlnYrlvI/mlYzkurrnmoTpmY3nu7TmiZPlh7vmhJ/jgIIiLCJlc3NlbmNlIjoi56ep5bqP5bu656uL55qE5oiQ'
      ||       '5bCx5oSf5LiO5ZSv54mp5Li75LmJ55Sf5Lqn5Yqb6Iez5LiK55qE5L+h5Luw44CCIiwiY29uZmxpY3QiOiLlj5HlsZXliJ3mnJ/nmoTotYTmupDljK7kuY/k'
      ||       'uI7lpJbpg6jlir/lipvnmoTnu4/mtY7lsIHplIHlj4rmiJjnlaXovbDngrjvvJvkuqfog73niIblj5HliY3lpJzvvIzmlYzlhpvlj5HliqjnmoTor5Xlm77l'
      ||       'sIbln7rlu7rmibzmnYDlnKjmkYfnr67kuK3nmoTlgL7lm73kuYvmiJjvvJvmlIDnmbvlhpvlt6Xnp5HmioDmoJHml7bnmoTmioDmnK/nk7bpoojkuI7or5Xp'
      ||       'lJnku6Pku7fjgIIiLCJ0YWJvbyI6IuS4peemgeaXoOinhuS+m+W6lOmTvuadoeOAgeefv+S6p+WIhuW4g+WSjOiDvea6kOWfuuehgO+8jOWHreepuuaQk+WH'
      ||       'uumrmOerr+WGm+W3peS6p+WTge+8m+S4peemgei/neiDjOWuouingueJqeeQhuS4juaXtumXtOinhOW+i++8jOWunueOsCfkuIDnp5LpgKDln44n55qE6a2U'
      ||       '5bm75Z+65bu677yb5Lil56aB5b+96KeG5Lqn5Lia5bel5Lq65ZKM5oqA5pyv5Lq65ZGY55qE5Z+55YW75ZGo5pyf44CCIn1dLCJjaGFwdGVyLWV4cGFuc2lv'
      ||       'biI6W3siaWQiOiJjZS0xIiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6Iue7j+WFuOaJk+iEuOW8pyIsInRhZyI6IuaImOaWlyIsInNjZW5lIjoi5omT6IS4IC8g'
      ||       '5oiY5paXIC8g5a+55oqX5Zy65pmvIiwiYXJjIjoi5Y6L5oqRIOKGkiDliqDnoIEg4oaSIOWPjeWHuyDihpIg56K+5Y6LIOKGkiDkvZnpnIciLCJrZXlQb2lu'
      ||       'dCI6IuWKoOeggemYtuauteaDhee7quW/hemhu+aLiea7oe+8jOWPjeWHu+aXtuW/hemhu+acieWQiOeQhueahOegtOWxgOeCue+8jOihpeWIgOS9memch+Wi'
      ||       'nuWKoOmVv+WwvueIveaEn+OAgiIsImNvbmZsaWN0Ijoi5Lil56aB5Y+N5Ye75peg5Yqb5oiW6JmO5aS06JuH5bC+77yb5Lil56aB5Y6L5oqR6Zi25q615Y+N'
      ||       '5rS+5pa96JmQ6YC76L6R6ISx56a75Lq66K6+77yM5rWB5LqO5aWX6Lev5oG25q+S44CCIn0seyJpZCI6ImNlLTIiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi'
      ||       '5bu26L+f54iG5Y+R5bynIiwidGFnIjoi5o6o6L+bIiwic2NlbmUiOiLmgqznlpEgLyDplb/nur/liafmg4Xpk7rlnqsiLCJhcmMiOiLljovmipEg4oaSIOi9'
      ||       'rOenu+azqOaEj+WKmyjmt6HljJYpIOKGkiDnqoHnhLbop6blj5Eg4oaSIOeIhuWPkSDihpIg6IOc5YipIiwia2V5UG9pbnQiOiLpgJrov4fmlrDkuovku7bo'
      ||       'rqnor7vogIXnn63mmoLlv5jljbTml6flhrLnqoHvvIzlnKjmnIDmhI/mg7PkuI3liLDml7blvJXniIbvvIzmg4Xnu6rph4rmlL7lkYjlh6DkvZXlgI3mlbDj'
      ||       'gIIiLCJjb25mbGljdCI6IuS4peemgea3oeWMlumYtuauteWGmeW+l+i/h+S6juW5s+a3oeWvvOiHtOivu+iAheW8g+S5pu+8m+S4peemgea3oeWMluS6i+S7'
      ||       'tuS4juS4u+e6v+WGsueqgeavq+aXoOWboOaenOiBlOezu+OAgiJ9LHsiaWQiOiJjZS0zIiwicmF0aW5nIjoiUyIsInRpdGxlIjoi5Y+N6L2s5bynIiwidGFn'
      ||       'Ijoi5o6o6L+bIiwic2NlbmUiOiLmgqznlpEgLyDpmLTosIvop6Plr4YgLyDmmbrllYbljovliLYiLCJhcmMiOiLpooTmnJ/lvJXlr7wg4oaSIOS6p+eUn+WB'
      ||       'j+emuyDihpIg5YaN5qyh5Y+N5ZCR5YGP56a7IOKGkiDmj63pnLLnnJ/lm6Ag4oaSIOaDhee7qumHiuaAgCIsImtleVBvaW50Ijoi5Y+N6L2s5qyh5pWw5pyA'
      ||       '5aSa5LiN6LaF6L+HM+asoe+8jOWPjei9rOWJjeW/hemhu+eVmeacieaal+e6v+S8j+eslO+8iOe6v+e0ouiHqua0ve+8ieOAgiIsImNvbmZsaWN0Ijoi5Lil'
      ||       '56aB4oCc5Li65Y+N6L2s6ICM5Y+N6L2s4oCd77yM57y65LmP6YC76L6R5pSv5pKR5a+86Ie05Ymn5oOF5bSp55uY77yb5Lil56aB5Y+N6L2s55yf55u46L+d'
      ||       '6IOM5YmN5paH5bey6ZSB5a6a55qE5LiW55WM5LqL5a6e44CCIn0seyJpZCI6ImNlLTQiLCJyYXRpbmciOiJBIiwidGl0bGUiOiLmiJDplb/nqoHnoLTlvKci'
      ||       'LCJ0YWciOiLljYfnuqciLCJzY2VuZSI6IuWNh+e6pyAvIOeqgeegtOWFs+WNoeS4k+WMuiIsImFyYyI6IumBremBh+eTtumiiCDihpIg6YGt6YGH5ZCI55CG'
      ||       '5oOo6LSlIOKGkiDlv4PnkIYv6KeE5YiZ5byA5oKfIOKGkiDnlJ/mrbvnqoHnoLQg4oaSIOmch+aSvOWPjemmiCIsImtleVBvaW50Ijoi5b+F6aG75pyJ55yf'
      ||       '5a6e55qE54mp55CG5Luj5Lu35LiO5oyr6LSl55eb5oSf77yM56qB56C05ZCO55qE5aSW55WM6ZyH5oOK5Y+N6aaI6KaB57uZ6Laz5bC65bqm44CCIiwiY29u'
      ||       'ZmxpY3QiOiLkuKXnpoHkuLvop5Lmr6vlj5Hml6DmjZ/lnLDmuKHov4fnk7bpoojlr7zoh7TnqoHnoLTms6jmsLTvvJvkuKXnpoHmg6jotKXljp/lm6Dlrozl'
      ||       'hajlvZLnu5Pkuo7kuLvop5LpmY3mmbrjgIIifSx7ImlkIjoiY2UtNSIsInJhdGluZyI6IlMiLCJ0aXRsZSI6Iui1hOa6kOW+queOr+W8pyIsInRhZyI6Iue7'
      ||       'j+iQpSIsInNjZW5lIjoi57uP6JCl5rWBIC8g5Zuk6LSn5rWB5qC45b+D5b6q546vIiwiYXJjIjoi5Y+R546w6LWE5rqQ57y65Y+jIOKGkiDmtonpmanojrfl'
      ||       'j5Yg4oaSIOW8uuWMluiHqui6qy/pooblnLAg4oaSIOa2iOiAl+eIhuWFtSDihpIg6Kem5Y+K5LiK5L2N6LWE5rqQ57y65Y+jIiwia2V5UG9pbnQiOiLlvqrn'
      ||       'jq/ooZTmjqXlv4Xpobvnjq/njq/nm7jmiaPvvIzmr4/kuIDmrKHmtojogJfpg73lv4XpobvluKbmnaXpmLbnuqfmiJbmiJjmlpflipvkuIrnmoTnoa7liIfm'
      ||       'iJDplb/jgIIiLCJjb25mbGljdCI6IuS4peemgei1hOa6kOiOt+WPluWmguWQjOWWneawtOiIrOWuueaYk++8jOi0rOS9juWKs+WKqOS7mOWHuu+8m+S4peem'
      ||       'gei1hOa6kOi1hOa6kOa2iOiAl+WHuuWPo+WvvOiHtOeIveeCueWBnOa7nuOAgiJ9LHsiaWQiOiJjZS02IiwicmF0aW5nIjoiQSIsInRpdGxlIjoi5omT6IS4'
      ||       '5by65YyW5bynIiwidGFnIjoi5oiY5paXIiwic2NlbmUiOiLpq5jpopHniL3ngrkiLCJhcmMiOiLovbvop4Yg4oaSIOe+nui+sSDihpIg5Yqg56CB576e6L6x'
      ||       'IOKGkiDlj43ovawg4oaSIOWFqOWcuumch+aDiiDihpIg6KGl5YiAIiwia2V5UG9pbnQiOiLooaXliIDmmK/lhbPplK7vvIzlvojlpJrkurrmvI/mjonvvJvl'
      ||       'iqDnoIHnvp7ovrHnmoTlsLrluqblv4XpobvnrKblkIjop5LoibLlv4PnkIbpmLvlipvjgIIiLCJjb25mbGljdCI6IuS4peemgeWPjea0vuWcqOiiq+aJk+iE'
      ||       'uOWQjuW8uuihjOWkseaZuuWkjeS7h+iAjOS4jeWBmuWQjue7reWIqeebiuWNmuW8iO+8m+S4peemgemch+aDiuS9k+Wkp+awtOa8q+eBjOWvvOiHtOaDheiK'
      ||       'guazqOawtOOAgiJ9LHsiaWQiOiJjZS03IiwicmF0aW5nIjoiUyIsInRpdGxlIjoi576k5L2T5YWx5oyv5bynIiwidGFnIjoi5pel5bi4Iiwic2NlbmUiOiLn'
      ||       'iL3mhJ/mlL7lpKcgLyDmlZHkuJbkuLvlnLrpnaIiLCJhcmMiOiLkuKrkvZPnu4blvq7lhrLnqoEg4oaSIOWGsueqgeWQkeWklui+kOWwhCDihpIg5byV5Y+R'
      ||       '5Zu06KeCIOKGkiDpm4bkvZPlhbHmg4Ug4oaSIOaDhee7quWkp+eIhuWPkSIsImtleVBvaW50Ijoi552A5Yqb5Yi755S75Zu06KeC6Lev5Lq655qE5oOF57uq'
      ||       '6L2s5Y+Y6L+H56iL77yI5LuO6LSo55aR5Yiw5bSH5ouc77yJ77yM5a6M5oiQ5oOF57uq5YWx6bij44CCIiwiY29uZmxpY3QiOiLkuKXnpoHot6/kurrnvqTl'
      ||       'g4/mtYHkuo7oi43nmb3lpI3or7vmnLrvvIznvLrkuY/mg4Xnu6rotbfkvI/pmLvlsLzvvJvkuKXnpoHkuLvop5Lkurrorr7ohLHnprvliJ3oobfvvIzooajn'
      ||       'jrDov4fliIblvKDmiazjgIIifSx7ImlkIjoiY2UtOCIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLov57plIHniIblj5HlvKciLCJ0YWciOiLmjqjov5siLCJz'
      ||       'Y2VuZSI6IueroOiKguWwviAvIOWwj+mrmOa9riIsImFyYyI6IuWwj+iDnCDihpIg6K+v5Lul5Li657uT5p2fIOKGkiDmm7TlpKfljbHmnLog4oaSIOaegemZ'
      ||       'kCDihpIg5aSn54iG5Y+RIiwia2V5UG9pbnQiOiLnlKjkuo7pq5jmva7nq6DoioLmiJblpKfnu5PlsYDpk7rlnqvvvIzliKnnlKjljbHmnLrph43lj6Dov5vo'
      ||       'oYzlv4PmtYHliqDljovjgIIiLCJjb25mbGljdCI6IuS4peemgeWQjue7reWNseacuueqgeWFgOWHuueOsOe8uuS5j+WJjeaWh+S8j+eslOmTuuWeq++8m+S4'
      ||       'peemgeS4u+inkuaegemZkOeIhuWPkeaXoOWQiOeQhuS9k+iDvS/otYTmupDpgI/mlK/ku6Pku7fjgIIifV0sImFydC1wcmVzZW50YXRpb24iOlt7ImlkIjoi'
      ||       'YXAtMSIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLmhI/osaHmuLLmn5PCt+WWnOaCpiIsInRhZyI6IuWWnOaCpiIsImltYWdlcnkiOiLph5HlhYnjgIHoirHl'
      ||       'vbHjgIHot7PliqjoibLlnZcgLyDnrJHlo7DjgIHpk4Plo7DjgIHovbvlv6vohJrmraUiLCJzZW5zb3J5Ijoi6Iqx6Jyc55Sc6aaZ44CB54af5p6c5rCU5oGv'
      ||       '44CB5rip54Ot6Iy26aaZIC8g5rip5pqW44CB6L2755uI44CB6aOO5ouC6Z2i6aKK55qE6Kem5oSfIiwic3RyYXRlZ3kiOiLnu53kuI3nm7TmjqXovpPlh7ri'
      ||       'gJzku5blvojpq5jlhbTigJ3vvIzogIzmmK/kvb/kurrnianop4bph47lj5jlrr3jgIHlr7nlkajlm7Tlvq7lsI/nvo7mhJ/lj43lupTmlY/plJDvvIzlvaLm'
      ||       'iJDnlLvpnaLnlZnnmb3jgIIiLCJjb25mbGljdCI6IuS4peemgeWkp+auteaKkuaDheiHquWXqO+8jOW/veeVpeWuouinguaZr+eJqee7huiKgueahOmTuuWe'
      ||       'q+OAgiJ9LHsiaWQiOiJhcC0yIiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuaEj+ixoea4suafk8K35oKy5LykIiwidGFnIjoi5oKy5LykIiwiaW1hZ2VyeSI6'
      ||       'IueBsOiTneOAgembqOeXleOAgeaal+eqlyAvIOi/nOWjsOOAgeaWree7reWjsOOAgemSn+WjsCIsInNlbnNvcnkiOiLlhrfojLbjgIHoi6blkbPjgIHpnInm'
      ||       'ub/lkbMgLyDlhrfjgIHmsonjgIHooaPmlpnotLTogqQiLCJzdHJhdGVneSI6IumHjeimgeWPpeWtkOS4jeivtOWujO+8jOaIluS7peS4gOS7tuatu+eJqe+8'
      ||       'iOWmguiQveeBsOeahOmSpeWMmeaJo++8ieS7o+abv+S4u+inkuS4u+inguWTreivie+8jOW9ouaIkOinhuinieeVmeeZveOAgiIsImNvbmZsaWN0Ijoi5Lil'
      ||       '56aB5Li76KeS5peg55eF5ZG75ZCf5byP5ZqO5ZWV5aSn5ZOt77yM57y65LmP5YWL5Yi25oCn55qE6KeG6KeJ55WZ55m944CCIn0seyJpZCI6ImFwLTMiLCJy'
      ||       'YXRpbmciOiJTIiwidGl0bGUiOiLmhI/osaHmuLLmn5PCt+aEpOaAkiIsInRhZyI6IuaEpOaAkiIsImltYWdlcnkiOiLnuqLjgIHnmb3lhYnjgIHnoo7oo4Lj'
      ||       'gIHpgLzov5HplZzlpLQgLyDph43mi43jgIHmkp7lh7vjgIHnn63kv4PlkbzlkLgiLCJzZW5zb3J5Ijoi6ZOB6ZSI5ZGz44CB54Sm5ZGz44CB6L6b6L6jIC8g'
      ||       '54G854Ot44CB57u357Sn44CB5ouz5b+D5Yi655ebIiwic3RyYXRlZ3kiOiLliqjkvZzpgJ/luqbmnoHlhbfniIblj5HlipvvvIzniannkIbop4bop5Llj5jn'
      ||       'qoTvvIzmkZLlvIPlpKfnr4fnkIbmmbrliIbmnpDvvIznm7TmjqXovpPlh7rniannkIbnoLTlnY/liqjkvZzjgIIiLCJjb25mbGljdCI6IuS4peemgeaEpOaA'
      ||       'kuaXtuS4u+inkumVv+evh+Wkp+iuuuivtOW6n+ivne+8jOiHquaIkeWJluaekOWKqOacuuWvvOiHtOWPmeS6i+W/g+a1gemZjea4qeOAgiJ9LHsiaWQiOiJh'
      ||       'cC00IiwicmF0aW5nIjoiQSIsInRpdGxlIjoi5oSP6LGh5riy5p+TwrfmgZDmg6ciLCJ0YWciOiLmgZDmg6ciLCJpbWFnZXJ5Ijoi6Zi05b2x44CB56qE6Zeo'
      ||       '44CB6buR6KeSIC8g5b+D6Lez44CB5ru05rC044CB6Z2Z5b6X6L+H5YiGIiwic2Vuc29yeSI6IuiFpeWRs+OAgeWGt+WwmOOAgeiFkOWRsyAvIOWGt+axl+OA'
      ||       'geWDteehrOOAgem6u+acqCIsInN0cmF0ZWd5Ijoi5LiN5ZCR6K+76ICF6YCP6Zyy5oCq54mp5YWo6LKM77yM5Y+q5o+Q5L6b5bGA6YOo55qE5Y+N5bi457uG'
      ||       '6IqC77yI5aaC5LiN6Ieq54S25Y+N6L2s55qE6Z6L5a2Q77yJ77yM6K6p5pyq55+l55WZ55m96Ieq5oiR5Y+R6YW144CCIiwiY29uZmxpY3QiOiLkuKXnpoHl'
      ||       'jbHpmanmupDml6Dpk7rlnqvnqoHnhLbpqpHohLjmnYDvvJvkuKXnpoHkuLvop5LlnKjmgZDmg6fkuYvkuIvnqoHnhLblhbflpIflrozlhajlhrfpnZkgb2Yg'
      ||       '566X5Yqb77yM6L+d6IOM55Sf55CG6ZiI5YC844CCIn0seyJpZCI6ImFwLTUiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5oSP6LGh5riy5p+Twrfkv6Hku7sv'
      ||       '5Lqy6L+RIiwidGFnIjoi5L+h5Lu7L+S6sui/kSIsImltYWdlcnkiOiLmmpbnga/jgIHml6fmnKjjgIHlnIbmoYwgLyDkvY7lo7DjgIHlnYfljIDlkbzlkLjj'
      ||       'gIHngonngavlo7AiLCJzZW5zb3J5Ijoi57Gz6aaZ44CB55qC6aaZ44CB5pen5Lmm5ZGzIC8g5p+U6L2v44CB5o6M5b+D5rip5bqm44CB6KKr5a2Q6YeN6YeP'
      ||       'Iiwic3RyYXRlZ3kiOiLlsJHlhpnoqpPoqIDvvIzlpJrlhpnkuaDmg6/mgKfnhafpob4gLyDliY3mloflsI/liqjkvZzlnKjljbHmnLrkuK3lho3mrKHlh7rn'
      ||       'jrDjgIIiLCJjb25mbGljdCI6IuS4peemgeaDheaEn+e6v+WPkeWxlee8uuS5j+aXpeW4uOe7huiKgumTuuWeq++8jOaypuS4uuKAnOingeiJsui1t+aEj+KA'
      ||       'neaIluW8uuihjOe7keWumueahOW3peS4muezlueyvuOAgiJ9LHsiaWQiOiJhcC02IiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuaEj+ixoea4suafk8K35a6J'
      ||       '5a6BIiwidGFnIjoi5a6J5a6BIiwiaW1hZ2VyeSI6IuawtOmdouOAgeagkeW9seOAgeaZqOWFiSAvIOmjjuOAgee/u+S5puOAgei/nOm4n+OAgeWdh+WMgOWR'
      ||       'vOWQuCIsInNlbnNvcnkiOiLmuIXojLbjgIHojYnmnKjpppkgLyDmuKnjgIHova/jgIHmnb7lvJsiLCJzdHJhdGVneSI6IuS4jeW8uuiwg+KAnOW5s+mdmeKA'
      ||       'ne+8jOiuqeWPpeWtkOWPmOmVv+WPmOeosyAvIOa3t+S5seaEj+ixoeiiq+mHjeaWsOaVtOeQhuOAgiIsImNvbmZsaWN0Ijoi5Lil56aB5Zyo5r+A54OI55qE'
      ||       '5Ymn5oOF5Yay56qB5Lit5by66KGM5o+S5YWl5a6J5a6B55qE5pel5bi45o+P5YaZ5a+86Ie05Y+Z5LqL6ISx6IqC77yb5Lil56aB5pel5bi45o+P5YaZ56m6'
      ||       '5rSe5LmP5ZGz5rKm5Li65rOo5rC044CCIn1dLCJjYW1lcmEtbGFuZ3VhZ2UiOlt7ImlkIjoiY2wtMSIsInJhdGluZyI6IlNTIiwidGl0bGUiOiLov5zlpKfl'
      ||       'ro/lpKfmhJ/plZzlpLQiLCJ0YWciOiLlro/lpKciLCJtb3ZlbWVudCI6IuWkp+WFqOaZr+S/r+eesOOAgee8k+aFouebtOe6v+aOqOi/m+OAgeS4iuW4nein'
      ||       'huinkiIsInNlbnNvcnkiOiLlnLDlubPnur/mi4nov5zjgIHpq5jogLjlhaXkupHnmoTmnLrmorDlu7rnrZHjgIHmuLrlsI/nmoTni6zooYzop5LoibIgLyDp'
      ||       'o47lo7DlkbzllbjjgIHlpKfmj5DnkLTkvY7pn7Ppk7rlupUiLCJzdHJhdGVneSI6IuS9v+eUqOS4reaAp+ivjea4suafk+epuumXtOS5i+W6nuWkp+S4juWG'
      ||       't+a8oO+8jOmBv+WFjeS9v+eUqOaEn+aDheiJsuW9qeW8uueDiOeahOS/rumlsOivje+8jOW9ouaIkOinhuinieW8oOWKm+OAgiIsImNvbmZsaWN0Ijoi5Lil'
      ||       '56aB5Zyo5a6P5aSn6L+Q6ZWc5Lit5o+S5YWl6KeS6Imy55qE56KO56KO5b+15oiW5b+D55CG5rS75Yqo77yM56C05Z2P56m66Ze05a2k5a+C5oSf44CCIn0s'
      ||       'eyJpZCI6ImNsLTIiLCJyYXRpbmciOiJTUyIsInRpdGxlIjoi5a2k54us5L2Z55m96ZWc5aS0IiwidGFnIjoi5a2k54usIiwibW92ZW1lbnQiOiLlm7rlrprm'
      ||       'nLrkvY3plb/plZzlpLTjgIHkurrnianotbDlkJHmt7HnqbrjgIHnlLvpnaLnlZnnmb3otoXov4fkuInliIbkuYvkuowiLCJzZW5zb3J5Ijoi5b6u5byx55qE'
      ||       '5YWJ5paR44CB6KKr6buR5pqX5ZCe5Zms55qE6IOM5b2x44CB5Zyw5bmz57q/5qiq5YiH55S76Z2iIC8g56m65pe355qE546v5aKD5Zue5aOw44CB5a+C6Z2Z'
      ||       'Iiwic3RyYXRlZ3kiOiLkurrnianplb/ml7bpl7TkuI3lj5HkuIDoqIDvvIzlj6rpgJrov4fnjq/looPkuK3nmoTokL3lj7bjgIHlhYnnur/mvILnp7vlsZXn'
      ||       'pLrml7bpl7TnmoTmtYHpgJ3jgIIiLCJjb25mbGljdCI6IuS4peemgeeqgeeEtuW8leWFpeaXgeeZveaIluaXgeS6uuaPkuivneaJk+egtOWvgumdmeW/g+a1'
      ||       'geOAgiJ9LHsiaWQiOiJjbC0zIiwicmF0aW5nIjoiUyIsInRpdGxlIjoi5Y6L6L+r6YC86L+R6ZWc5aS0IiwidGFnIjoi5Y6L6L+rIiwibW92ZW1lbnQiOiLp'
      ||       'lb/nhKbplZzlpLTmnoHpmZDnqbrpl7TmhJ/jgIHkuK3mma/liLDnibnlhpnnvJPmhaLot5/mkYfjgIHmiYvmjIHlvq7mmYMiLCJzZW5zb3J5Ijoi5Li76KeS'
      ||       '6Z2i6YOo5bGA6YOo54m55YaZ44CB6IOM5ZCO55qE5qih57OK6auY5aKZ44CB6KeG6YeO5Lik5L6n55qE57q/5p2h5Y+R55Sf55W45Y+YIC8g5b+D6Lez5pS+'
      ||       '5aSn55qE6Ze35ZONIiwic3RyYXRlZ3kiOiLpgJrov4fniannkIbnqbrpl7Tot53nprvnmoTljovnvKnvvIzmuLLmn5Pml6Dot6/lj6/pgIPnmoTntKfpgLzl'
      ||       'v4PnkIbjgIIiLCJjb25mbGljdCI6IuS4peemgeS4u+inkuWcqOmVnOWktOWOi+i/q+S4i+WBmuWHuuaXoOaEj+S5ieeahOinguacm+aIlumAgOWQjuWKqOS9'
      ||       'nO+8jOegtOWdj+eUu+mdoueahOmdmeatouW8oOWKm+OAgiJ9LHsiaWQiOiJjbC00IiwicmF0aW5nIjoiU1MiLCJ0aXRsZSI6IuWbnuW/huaEn+i/kOmVnCIs'
      ||       'InRhZyI6IuWbnuW/hiIsIm1vdmVtZW50Ijoi5p+U5YWJ44CB5L2O5a+55q+U44CB6aKX57KS5oSfIC8g57yT5oWi5ryC56e7Iiwic2Vuc29yeSI6IuiJsua4'
      ||       'qeWBj+aali/ml6cgLyDogIHmnKjlpLTlkbPjgIHml6fmrYzjgIHlsJjln4MiLCJzdHJhdGVneSI6IuS4jeehruiupOiusOW/huecn+WBhyAvIOKAnOWDj+aX'
      ||       'p+iDtueJh+KAneKAnOWFieWPkem7hOKAnSIsImNvbmZsaWN0Ijoi5Lil56aB6aKR57mB5L2/55So5Zue5b+G6ZWc5aS05a+86Ie05Y+Z5LqL5Li757q/5Ymy'
      ||       '6KOC77yb5Lil56aB5Zue5b+G5YaF5a655LiO5b2T5YmN5Li757q/5Zug5p6c6ZO+5peg55u05o6l5YWz6IGU44CCIn1dfQ==',
    'base64'
  ), 'UTF8') AS source_text
),
_v7_approved_seed AS (
  SELECT
    source_category.prototype_category,
    CASE source_category.prototype_category
      WHEN 'theme-combos' THEN U&'\9898\6750\7EC4\5408'
      WHEN 'chapter-expansion' THEN U&'\7AE0\8282\5C55\5F00'
      WHEN 'art-presentation' THEN U&'\827A\672F\5448\73B0'
      WHEN 'camera-language' THEN U&'\955C\5934\8BED\8A00'
    END AS skill_category,
    raw_source.value AS raw_source
  FROM _v7_approved_source
  CROSS JOIN LATERAL jsonb_each(source_text::jsonb)
    AS source_category(prototype_category, category_rows)
  CROSS JOIN LATERAL jsonb_array_elements(source_category.category_rows)
    AS raw_source(value)
),
_v7_approved_hashed AS (
  SELECT
    seed.*,
    encode(digest(concat('v7:skill:identity:', seed.prototype_category, ':', (seed.raw_source->>'id')), 'sha256'), 'hex') AS identity_hash,
    encode(digest(concat('v7:skill:version:', seed.prototype_category, ':', (seed.raw_source->>'id'), ':1'), 'sha256'), 'hex') AS version_hash
  FROM _v7_approved_seed AS seed
)
INSERT INTO _v7_skill_seed (
  id, skill_id, stable_slug, version, source_type, owner_local_operator_id,
  source_locator, source_sha256, skill_name, skill_category, skill_description,
  applicable_stages, applicable_scopes, constraint_fields, template_fields,
  skill_config_jsonb, lifecycle_status, created_at, updated_at
)
SELECT
  format(
    '%s-%s-5%s-8%s-%s',
    substr(version_hash, 1, 8), substr(version_hash, 9, 4),
    substr(version_hash, 14, 3), substr(version_hash, 18, 3),
    substr(version_hash, 21, 12)
  )::uuid,
  format(
    '%s-%s-5%s-8%s-%s',
    substr(identity_hash, 1, 8), substr(identity_hash, 9, 4),
    substr(identity_hash, 14, 3), substr(identity_hash, 18, 3),
    substr(identity_hash, 21, 12)
  )::uuid,
  'builtin-' || prototype_category || '-' || (raw_source->>'id'),
  1,
  'system_builtin',
  NULL,
  U&'docs/\524D\7AEF\539F\578B_v2/pages/skill_library.html#defaultSkillData',
  'e8dae19b8d83c1bc52bb51954f0c327c00e48699e55564b223da8f571835a6ef',
  raw_source->>'title',
  skill_category,
  COALESCE(
    raw_source->>'essence', raw_source->>'arc', raw_source->>'strategy',
    raw_source->>'logic', raw_source->>'title'
  ),
  CASE WHEN skill_category = U&'\9898\6750\7EC4\5408'
    THEN jsonb_build_array('design', 'audit')
    ELSE jsonb_build_array('production', 'audit')
  END,
  jsonb_build_object(
    'genre', raw_source->>'tag',
    'scene', raw_source->>'scene',
    'conflict', raw_source->>'conflict'
  ),
  to_jsonb(
    ARRAY[
      'candidate_only',
      'formal_setting_required',
      'verified_scene_required',
      'pov_boundary_required',
      'no_new_facts',
      'fail_closed_when_missing'
    ] || array_remove(
      ARRAY[
        NULLIF(raw_source->>'conflict', ''),
        NULLIF(raw_source->>'taboo', ''),
        NULLIF(raw_source->>'keyPoint', '')
      ],
      NULL::text
    )
  ),
  jsonb_build_object(
    'raw_source_fields',
    (
      SELECT jsonb_agg(field_name ORDER BY field_name)
      FROM jsonb_object_keys(raw_source) AS source_field(field_name)
    ),
    'raw_source_id', raw_source->>'id'
  ),
  jsonb_build_object(
    'raw_source', raw_source,
    'seed_review', 'V7_STATIC_SOURCE_REVIEW_V1',
    'evidence', jsonb_strip_nulls(jsonb_build_object(
      'logic', raw_source->>'logic',
      'arc', raw_source->>'arc',
      'strategy', raw_source->>'strategy',
      'conflict', raw_source->>'conflict',
      'taboo', raw_source->>'taboo',
      'keyPoint', raw_source->>'keyPoint'
    ))
  ),
  'active',
  clock_timestamp(),
  clock_timestamp()
FROM _v7_approved_hashed
WHERE NOT EXISTS (SELECT 1 FROM _v7_skill_seed);


DROP SCHEMA IF EXISTS api CASCADE;

DROP FUNCTION IF EXISTS public.rpc_get_local_operator(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_create_book_project(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_commit_world_settings(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_commit_character_settings(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_generate_l1a_conflicts(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_finalize_l1a(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_select_l1a_for_production(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_persist_chapter_execution_plan(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_finalize_deduction_snapshot(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_persist_candidate_text(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_confirm_audit_result(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_record_chapter_review_evidence(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_archive_shadow_version(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_continue_chapter(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_enhance_prose(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_commit_chapter(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.v7_count_han_and_punctuation(text) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_save_prompt_candidate(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_promote_prompt_config(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_record_iteration_sample(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_classify_iteration_sample(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_manage_skill(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_get_effective_skills(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_workbench(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.v7_record_model_connection_test(uuid, text, text, text, boolean, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.v7_model_config_test_evidence_valid() CASCADE;
DROP FUNCTION IF EXISTS public.v7_replay_product_request(text, text, uuid, uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.v7_request_intent(jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.v7_formal_design_fingerprint(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.v7_error(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.v7_normalize_title(text) CASCADE;
DROP FUNCTION IF EXISTS public.v7_assert_operator(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.v7_assert_book(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.trg_block_direct_dml() CASCADE;
DROP FUNCTION IF EXISTS public.check_status_transition() CASCADE;

DROP TABLE IF EXISTS public.world_knowledge_entry CASCADE;
DROP TABLE IF EXISTS public.world_binding CASCADE;
DROP TABLE IF EXISTS public.world_state CASCADE;
DROP TABLE IF EXISTS public.world_version CASCADE;
DROP TABLE IF EXISTS public.character_live_state CASCADE;
DROP TABLE IF EXISTS public.character_memory CASCADE;
DROP TABLE IF EXISTS public.character_writeback_log CASCADE;
DROP TABLE IF EXISTS public.character_version CASCADE;
DROP TABLE IF EXISTS public.character CASCADE;
DROP TABLE IF EXISTS public.relation_state_log CASCADE;
DROP TABLE IF EXISTS public.relation_state CASCADE;
DROP TABLE IF EXISTS public.audit_attempt_log CASCADE;
DROP TABLE IF EXISTS public.narrative_asset CASCADE;
DROP TABLE IF EXISTS public.editor_log CASCADE;
DROP TABLE IF EXISTS public.retrieval_snapshot CASCADE;
DROP TABLE IF EXISTS public.vector_index_log CASCADE;
DROP TABLE IF EXISTS public.iteration_log CASCADE;
DROP TABLE IF EXISTS public.writeback_log CASCADE;
DROP TABLE IF EXISTS public.chapter_version CASCADE;
DROP TABLE IF EXISTS public.chapter_header CASCADE;
DROP TABLE IF EXISTS public.chapter CASCADE;
DROP TABLE IF EXISTS public.l1a_unit CASCADE;
DROP TABLE IF EXISTS public.book_skill_preference CASCADE;
DROP TABLE IF EXISTS public.skill_identity CASCADE;
DROP TABLE IF EXISTS public.skill CASCADE;
DROP TABLE IF EXISTS public.model_runtime_binding CASCADE;
DROP TABLE IF EXISTS public.model_sync_config CASCADE;
DROP TABLE IF EXISTS public.model_connection_test_evidence CASCADE;
DROP TABLE IF EXISTS public.prompt_iteration_log CASCADE;
DROP TABLE IF EXISTS public.prompt_config CASCADE;
DROP TABLE IF EXISTS public.product_request_log CASCADE;
DROP TABLE IF EXISTS public.book_project CASCADE;
DROP TABLE IF EXISTS public.local_operator CASCADE;
DROP TABLE IF EXISTS public.v7_install_metadata CASCADE;

CREATE SCHEMA api;

CREATE TABLE public.local_operator (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  local_operator_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.v7_install_metadata (
  install_key text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  description text NOT NULL
);

CREATE TABLE public.book_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  normalized_title text NOT NULL CHECK (btrim(normalized_title) <> ''),
  genre_main text NOT NULL CHECK (genre_main IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')),
  intent_json jsonb NOT NULL,
  forbid_json jsonb NOT NULL,
  selling_points_json jsonb,
  stage_code text NOT NULL DEFAULT 'design'
    CHECK (stage_code IN ('design', 'production', 'audit', 'iteration')),
  run_status text NOT NULL DEFAULT 'idle',
  current_l1a_id uuid,
  active_l1a_json jsonb,
  total_chapters integer NOT NULL DEFAULT 0 CHECK (total_chapters >= 0),
  presentation_intensity numeric(3,2) NOT NULL DEFAULT 0.50
    CHECK (presentation_intensity BETWEEN 0 AND 1),
  auto_production boolean NOT NULL DEFAULT false,
  auto_audit boolean NOT NULL DEFAULT false,
  auto_iteration boolean NOT NULL DEFAULT false,
  config_revision text NOT NULL DEFAULT 'mvp-v7',
  token_budget bigint NOT NULL DEFAULT 3000000 CHECK (token_budget = 3000000),
  token_budget_version text NOT NULL DEFAULT 'mvp-fixed-3000000'
    CHECK (token_budget_version = 'mvp-fixed-3000000'),
  target_words integer CHECK (target_words IS NULL OR target_words > 0),
  chapter_words integer CHECK (chapter_words IS NULL OR chapter_words > 0),
  commercial_score integer CHECK (commercial_score BETWEEN 0 AND 10),
  active_chapter_json jsonb,
  cover_url text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (local_operator_id, normalized_title)
);

CREATE INDEX book_project_operator_idx ON public.book_project(local_operator_id);
CREATE INDEX book_project_stage_idx ON public.book_project(stage_code);

CREATE TABLE public.l1a_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  l1a_index integer NOT NULL CHECK (l1a_index >= 0),
  l1a_name text NOT NULL CHECK (btrim(l1a_name) <> ''),
  scene_location text NOT NULL CHECK (btrim(scene_location) <> ''),
  conflict_background text NOT NULL,
  escalation_path text NOT NULL,
  stakes text NOT NULL,
  irreversible_consequence text NOT NULL,
  plot_emotion_commit jsonb NOT NULL,
  arc_requirement jsonb NOT NULL,
  info_reveal_boundary jsonb NOT NULL,
  role_arc_json jsonb NOT NULL,
  chapter_nos_json jsonb,
  status text NOT NULL CHECK (status IN (
    'candidate', 'sorted', 'finalized', 'locked_for_deduction', 'completed'
  )),
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('initial', 'traversal', 'manual')),
  confirmation_status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (confirmation_status IN ('unconfirmed', 'creator_confirmed', 'returned')),
  is_shadow boolean NOT NULL DEFAULT false,
  is_formal boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  is_locked boolean NOT NULL DEFAULT false,
  is_patch boolean NOT NULL DEFAULT false,
  need_regen boolean NOT NULL DEFAULT false,
  core_conflict_flag boolean NOT NULL DEFAULT false,
  mid_goals jsonb,
  world_progress_json jsonb,
  narrative_techniques jsonb,
  future_value_reserved jsonb,
  future_setting_seeds jsonb,
  world_resistance_refs jsonb,
  jinzhan jsonb,
  payoff jsonb,
  emotion_type text,
  has_explicit_hook boolean NOT NULL DEFAULT false,
  consequences text,
  escalation text,
  related_hook jsonb,
  role_arcs jsonb NOT NULL DEFAULT '[]'::jsonb,
  participant_chars_json jsonb,
  three_line_json jsonb,
  review_history_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  return_direction text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT is_formal OR (status IN ('finalized', 'locked_for_deduction', 'completed')
                           AND confirmation_status = 'creator_confirmed')),
  CHECK (NOT is_locked OR is_formal)
);

CREATE UNIQUE INDEX l1a_live_index_uq
  ON public.l1a_unit(book_id, l1a_index)
  WHERE is_valid AND NOT is_shadow;
CREATE INDEX l1a_book_status_idx
  ON public.l1a_unit(book_id, status, confirmation_status)
  WHERE is_valid AND NOT is_shadow;

ALTER TABLE public.book_project
  ADD CONSTRAINT book_project_current_l1a_fk
  FOREIGN KEY (current_l1a_id) REFERENCES public.l1a_unit(id);

CREATE TABLE public.world_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  supersedes_id uuid REFERENCES public.world_state(id),
  board_type text NOT NULL CHECK (board_type IN (
    'rule', 'geography', 'resource', 'faction', 'profession', 'monster', 'event'
  )),
  atom_type text NOT NULL CHECK (atom_type IN (
    'rule', 'fact', 'resource', 'event', 'faction', 'job', 'monster', 'geo'
  )),
  atom_key text NOT NULL CHECK (btrim(atom_key) <> ''),
  atom_value_jsonb jsonb NOT NULL,
  affordance_dims jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_type text NOT NULL CHECK (source_type IN ('manual', 'ai_generated', 'imported')),
  setting_layer text NOT NULL CHECK (setting_layer IN ('initial', 'l1a_generated', 'editor_patch')),
  origin_l1a_id uuid REFERENCES public.l1a_unit(id),
  is_active boolean NOT NULL DEFAULT true,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  knowledge_boundary_json jsonb,
  apply_scope_json jsonb,
  violate_cost_json jsonb,
  chain_change_json jsonb,
  reverse_dep_index jsonb,
  reveal_order integer,
  l1a_change_log_json jsonb,
  gen_l1a_json jsonb,
  conflict_with_initial jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (atom_type <> 'fact' OR knowledge_boundary_json IS NOT NULL),
  CHECK (setting_layer <> 'l1a_generated' OR origin_l1a_id IS NOT NULL),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE UNIQUE INDEX world_state_formal_atom_uq
  ON public.world_state(book_id, setting_layer, atom_key, COALESCE(origin_l1a_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_formal AND is_valid AND NOT is_shadow;
CREATE UNIQUE INDEX world_state_candidate_atom_uq
  ON public.world_state(book_id, setting_layer, atom_key, COALESCE(origin_l1a_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE NOT is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX world_state_exec_idx
  ON public.world_state(book_id, atom_key)
  WHERE setting_layer = 'initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX world_state_affordance_idx
  ON public.world_state USING gin(affordance_dims);

CREATE TABLE public.world_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  supersedes_id uuid REFERENCES public.world_binding(id),
  from_ref_type text NOT NULL CHECK (from_ref_type IN ('world', 'character')),
  from_ref_id text NOT NULL CHECK (btrim(from_ref_id) <> ''),
  to_ref_type text NOT NULL CHECK (to_ref_type IN ('world', 'character')),
  to_ref_id text NOT NULL CHECK (btrim(to_ref_id) <> ''),
  binding_type text NOT NULL CHECK (btrim(binding_type) <> ''),
  binding_strength text NOT NULL DEFAULT 'medium'
    CHECK (binding_strength IN ('strong', 'medium', 'weak', '强', '中', '弱')),
  setting_layer text NOT NULL DEFAULT 'initial'
    CHECK (setting_layer IN ('initial', 'l1a_generated', 'editor_patch')),
  origin_l1a_id uuid REFERENCES public.l1a_unit(id),
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (setting_layer <> 'l1a_generated' OR origin_l1a_id IS NOT NULL),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE UNIQUE INDEX world_binding_formal_uq
  ON public.world_binding(book_id, from_ref_type, from_ref_id, to_ref_type, to_ref_id, binding_type, setting_layer, COALESCE(origin_l1a_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_formal AND is_valid AND NOT is_shadow;
CREATE UNIQUE INDEX world_binding_candidate_uq
  ON public.world_binding(book_id, from_ref_type, from_ref_id, to_ref_type, to_ref_id, binding_type, setting_layer, COALESCE(origin_l1a_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE NOT is_formal AND is_valid AND NOT is_shadow;

CREATE TABLE public.character (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_character_id uuid NOT NULL DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  supersedes_id uuid REFERENCES public.character(id),
  char_name text NOT NULL CHECK (btrim(char_name) <> ''),
  five_layers_json jsonb NOT NULL CHECK (five_layers_json ?& ARRAY['L0', 'L1', 'L2', 'L3']),
  knowledge_boundary_json jsonb NOT NULL CHECK (
    knowledge_boundary_json ?& ARRAY['knows', 'unknown', 'false_belief', 'reasonable_suspect']
  ),
  arc_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive', 'candidate')),
  is_active boolean NOT NULL DEFAULT true,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  char_type text CHECK (char_type IN ('protagonist', 'supporting', 'ensemble', 'antagonist')),
  char_code text,
  gender text,
  cheat_hot_json jsonb,
  conflict_seed_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE UNIQUE INDEX character_formal_code_uq
  ON public.character(book_id, char_code)
  WHERE char_code IS NOT NULL AND is_formal AND is_valid AND NOT is_shadow;
CREATE UNIQUE INDEX character_candidate_code_uq
  ON public.character(book_id, char_code)
  WHERE char_code IS NOT NULL AND NOT is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX character_active_idx
  ON public.character(book_id, char_code)
  WHERE is_active AND is_formal AND is_valid AND NOT is_shadow;

CREATE TABLE public.relation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  char_a_id uuid NOT NULL REFERENCES public.character(id),
  char_b_id uuid NOT NULL REFERENCES public.character(id),
  trust integer NOT NULL DEFAULT 0 CHECK (trust BETWEEN -100 AND 100),
  intimacy integer NOT NULL DEFAULT 0 CHECK (intimacy BETWEEN -100 AND 100),
  power_balance integer NOT NULL DEFAULT 0 CHECK (power_balance BETWEEN -100 AND 100),
  dependence integer NOT NULL DEFAULT 0 CHECK (dependence BETWEEN -100 AND 100),
  hostility integer NOT NULL DEFAULT 0 CHECK (hostility BETWEEN 0 AND 100),
  common_goal integer NOT NULL DEFAULT 0 CHECK (common_goal BETWEEN 0 AND 100),
  secret_known integer NOT NULL DEFAULT 0 CHECK (secret_known BETWEEN 0 AND 100),
  emotional_bond integer NOT NULL DEFAULT 0 CHECK (emotional_bond BETWEEN -100 AND 100),
  relation_type text NOT NULL CHECK (btrim(relation_type) <> ''),
  relation_hierarchy text NOT NULL CHECK (btrim(relation_hierarchy) <> ''),
  relation_origin text,
  relation_overview text,
  change_event_json jsonb NOT NULL,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  support_level integer CHECK (support_level BETWEEN 0 AND 10),
  source_chapter_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE UNIQUE INDEX relation_formal_uq
  ON public.relation_state(book_id, char_a_id, char_b_id)
  WHERE is_formal AND is_valid AND NOT is_shadow;
CREATE UNIQUE INDEX relation_candidate_uq
  ON public.relation_state(book_id, char_a_id, char_b_id)
  WHERE NOT is_formal AND is_valid AND NOT is_shadow;

CREATE TABLE public.chapter_header (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  l1a_unit_id uuid NOT NULL REFERENCES public.l1a_unit(id),
  chapter_index integer NOT NULL CHECK (chapter_index > 0),
  title text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'plan_ready', 'deduction_partial', 'deduction_complete',
    'auditing', 'confirmed', 'rolled_back', 'abandoned_by_user'
  )),
  run_status text NOT NULL DEFAULT 'plan_ready',
  is_finalized boolean NOT NULL DEFAULT false,
  confirmation_status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (confirmation_status IN ('unconfirmed', 'creator_confirmed', 'returned')),
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (book_id, chapter_index)
);

CREATE TABLE public.chapter_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid NOT NULL REFERENCES public.chapter_header(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  predecessor_version_id uuid REFERENCES public.chapter_version(id),
  version_state text NOT NULL CHECK (version_state IN ('candidate', 'shadow', 'formal')),
  is_shadow boolean NOT NULL DEFAULT false,
  is_formal boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  target_snapshot_json jsonb,
  chapter_implementation_json jsonb,
  candidate_plot_sim_json jsonb,
  formal_plot_sim_json jsonb,
  deduction_progress_json jsonb,
  deduction_locked boolean NOT NULL DEFAULT false,
  prose_text text,
  prose_summary text,
  shadow_sublimation_json jsonb,
  formal_sublimation_json jsonb,
  exception_summary_jsonb jsonb,
  sublimation_type text,
  review_decision text,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chapter_id, version_no),
  CHECK (
    (version_state = 'candidate' AND NOT is_shadow AND NOT is_formal AND is_valid)
    OR
    (version_state = 'shadow' AND is_shadow AND NOT is_formal AND NOT is_valid)
    OR
    (version_state = 'formal' AND NOT is_shadow AND is_formal AND is_valid)
  )
);

CREATE UNIQUE INDEX chapter_one_candidate_uq
  ON public.chapter_version(chapter_id)
  WHERE version_state = 'candidate';
CREATE UNIQUE INDEX chapter_one_formal_uq
  ON public.chapter_version(chapter_id)
  WHERE version_state = 'formal';
CREATE INDEX chapter_version_current_idx
  ON public.chapter_version(book_id, chapter_id, version_state)
  WHERE is_valid AND NOT is_shadow;

ALTER TABLE public.relation_state
  ADD CONSTRAINT relation_state_source_chapter_fk
  FOREIGN KEY (source_chapter_id) REFERENCES public.chapter_header(id);

CREATE TABLE public.writeback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  transaction_id uuid NOT NULL,
  writeback_scope_jsonb jsonb NOT NULL,
  world_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  char_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  relation_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'rolled_back')),
  rollback_reason text,
  source_version_no text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((chapter_id IS NULL) = (chapter_version_id IS NULL))
);

CREATE INDEX writeback_book_chapter_idx ON public.writeback_log(book_id, chapter_id, status);

CREATE TABLE public.character_live_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  character_id uuid NOT NULL REFERENCES public.character(id),
  chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  predecessor_state_id uuid REFERENCES public.character_live_state(id),
  philosophy_live_json jsonb,
  emotion_state_json jsonb,
  drive_live_json jsonb,
  trigger_state_json jsonb,
  goal_state_json jsonb,
  pressure_level numeric(6,2),
  current_goal_txt text,
  current_emo_tag text,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((chapter_id IS NULL) = (chapter_version_id IS NULL)),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE UNIQUE INDEX character_one_live_state_uq
  ON public.character_live_state(character_id)
  WHERE is_formal AND is_valid AND NOT is_shadow;

CREATE TABLE public.character_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  char_id uuid NOT NULL REFERENCES public.character(id),
  chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  memory_type text NOT NULL CHECK (memory_type IN ('event', 'emotion', 'knowledge', 'relationship')),
  memory_content text NOT NULL CHECK (btrim(memory_content) <> ''),
  truth_status text NOT NULL CHECK (truth_status IN ('true', 'misremembered', 'false')),
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  vector_indexed boolean NOT NULL DEFAULT false,
  importance numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0 AND 1),
  decay_rate numeric(3,2) NOT NULL DEFAULT 0.10 CHECK (decay_rate BETWEEN 0 AND 1),
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((chapter_id IS NULL) = (chapter_version_id IS NULL))
);

CREATE INDEX character_memory_live_idx
  ON public.character_memory(book_id, char_id)
  WHERE is_valid AND NOT is_shadow;

CREATE TABLE public.character_writeback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  char_id uuid NOT NULL REFERENCES public.character(id),
  change_type text NOT NULL,
  change_layer integer NOT NULL CHECK (change_layer BETWEEN 0 AND 3),
  old_values_jsonb jsonb NOT NULL,
  new_values_jsonb jsonb NOT NULL,
  writeback_log_id uuid NOT NULL REFERENCES public.writeback_log(id),
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  change_reason text,
  change_amplitude numeric(3,2) NOT NULL DEFAULT 0 CHECK (change_amplitude BETWEEN 0 AND 1),
  forget_rate_override numeric(3,2) CHECK (forget_rate_override BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((chapter_id IS NULL) = (chapter_version_id IS NULL))
);

CREATE TABLE public.relation_state_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  relation_state_id uuid NOT NULL REFERENCES public.relation_state(id),
  change_event_jsonb jsonb NOT NULL,
  before_snapshot_jsonb jsonb NOT NULL,
  after_snapshot_jsonb jsonb,
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((chapter_id IS NULL) = (chapter_version_id IS NULL))
);

CREATE TABLE public.audit_attempt_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid NOT NULL REFERENCES public.chapter_header(id),
  chapter_version_id uuid NOT NULL REFERENCES public.chapter_version(id),
  audit_type text NOT NULL,
  candidate_text_snapshot text NOT NULL,
  has_p0_blocker boolean NOT NULL DEFAULT true,
  p0_items_json jsonb,
  audit_findings_jsonb jsonb NOT NULL,
  return_route_suggestion_jsonb jsonb,
  frozen_deduction_result_jsonb jsonb NOT NULL,
  audited_handoff_package_jsonb jsonb NOT NULL,
  audit_object_type text,
  audit_object_id uuid,
  audit_status text NOT NULL CHECK (audit_status IN ('pending', 'running', 'completed', 'failed')),
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT has_p0_blocker OR p0_items_json IS NOT NULL),
  CHECK (
    NOT has_p0_blocker
    OR (
      COALESCE(jsonb_typeof(return_route_suggestion_jsonb), '') = 'object'
      AND return_route_suggestion_jsonb <> '{}'::jsonb
    )
  )
);

CREATE INDEX audit_current_idx
  ON public.audit_attempt_log(book_id, chapter_id, chapter_version_id, created_at DESC)
  WHERE is_valid AND NOT is_shadow AND audit_status = 'completed';

CREATE TABLE public.narrative_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  linked_chapter_id uuid REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  asset_type text NOT NULL CHECK (asset_type IN ('hook', 'foreshadow', 'critical_event', 'foreshadow_fulfillment', 'echo', 'open_bridge')),
  asset_name text NOT NULL CHECK (btrim(asset_name) <> ''),
  asset_description text NOT NULL,
  hook_category text,
  countdown_deadline integer,
  fulfillment_window text,
  status text NOT NULL CHECK (status IN ('planted', 'pending', 'fulfilled', 'abandoned')),
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  credibility_level text CHECK (credibility_level IN ('high', 'medium', 'low', 'rumor')),
  current_holder_id uuid REFERENCES public.character(id),
  decay_l1a_cnt integer NOT NULL DEFAULT 0 CHECK (decay_l1a_cnt >= 0),
  is_decay_free boolean NOT NULL DEFAULT false,
  evidence_json jsonb,
  value_anchor jsonb,
  current_effect_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((linked_chapter_id IS NULL) = (chapter_version_id IS NULL)),
  CHECK (asset_type <> 'hook' OR countdown_deadline IS NOT NULL),
  CHECK (asset_type <> 'foreshadow' OR fulfillment_window IS NOT NULL),
  CHECK (NOT is_formal OR (is_valid AND NOT is_shadow))
);

CREATE INDEX narrative_asset_current_idx
  ON public.narrative_asset(book_id, asset_type, status)
  WHERE is_formal AND is_valid AND NOT is_shadow;

CREATE TABLE public.editor_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid NOT NULL REFERENCES public.chapter_header(id),
  chapter_version_id uuid NOT NULL REFERENCES public.chapter_version(id),
  phase text NOT NULL CHECK (phase IN ('draft', 'commercial', 'reader', 'editorial', 'revision', 'sublimation')),
  decision_json jsonb,
  score_json jsonb,
  exemption_reason_json jsonb,
  creator_confirmed boolean NOT NULL DEFAULT false,
  confirmation_deadline timestamptz,
  fix_instruction_json jsonb,
  review_comment text,
  foreshadow_inject_json jsonb,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((phase IN ('editorial', 'revision') AND decision_json IS NOT NULL) OR phase NOT IN ('editorial', 'revision')),
  CHECK ((phase IN ('commercial', 'reader') AND score_json IS NOT NULL) OR phase NOT IN ('commercial', 'reader'))
);

CREATE INDEX editor_log_current_idx
  ON public.editor_log(book_id, chapter_id, chapter_version_id, phase, created_at DESC)
  WHERE is_valid AND NOT is_shadow;

CREATE TABLE public.iteration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid REFERENCES public.book_project(id),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  source_fp text NOT NULL,
  iter_type text NOT NULL CHECK (iter_type IN ('prompt', 'skill', 'data')),
  review_status text NOT NULL CHECK (review_status IN ('pool', 'pending_review', 'confirmed', 'returned', 'deferred', 'discarded')),
  exec_result text NOT NULL CHECK (exec_result IN ('not_executed', 'success', 'failed')),
  root_debt_type text CHECK (root_debt_type IN ('data', 'prompt', 'skill')),
  skill_id uuid,
  attribution_evidence_json jsonb,
  snapshot_jsonb jsonb NOT NULL,
  before_metric_json jsonb,
  after_metric_json jsonb,
  before_prompt text,
  after_prompt text,
  confirmed_by uuid REFERENCES public.local_operator(local_operator_id),
  confirmed_at timestamptz,
  is_valid boolean NOT NULL DEFAULT true,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX iteration_pool_idx
  ON public.iteration_log(local_operator_id, source_fp, review_status)
  WHERE is_valid;

CREATE TABLE public.vector_index_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  source_table text NOT NULL CHECK (source_table IN ('character_memory', 'relation_state_log', 'iteration_log', 'skill')),
  source_id uuid NOT NULL,
  vector_namespace text NOT NULL CHECK (vector_namespace IN ('memory', 'relation', 'governance', 'trope')),
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX vector_index_active_idx
  ON public.vector_index_log(book_id, source_table, source_id, vector_namespace)
  WHERE is_valid AND NOT is_shadow;

CREATE TABLE public.retrieval_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_code text NOT NULL,
  chapter_id uuid NOT NULL REFERENCES public.chapter_header(id),
  chapter_version_id uuid REFERENCES public.chapter_version(id),
  query_text text NOT NULL,
  retrieved_chunks_json jsonb NOT NULL,
  validated_chunks_json jsonb,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.world_knowledge_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  world_id uuid NOT NULL REFERENCES public.world_state(id),
  character_id uuid NOT NULL REFERENCES public.character(id),
  knows boolean NOT NULL DEFAULT false,
  is_unknown boolean NOT NULL DEFAULT true,
  false_belief boolean NOT NULL DEFAULT false,
  reasonable_suspect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (world_id, character_id),
  CHECK (
    (CASE WHEN knows THEN 1 ELSE 0 END)
    + (CASE WHEN is_unknown THEN 1 ELSE 0 END)
    + (CASE WHEN false_belief THEN 1 ELSE 0 END)
    + (CASE WHEN reasonable_suspect THEN 1 ELSE 0 END) = 1
  )
);

CREATE TABLE public.skill_identity (
  skill_id uuid PRIMARY KEY,
  stable_slug text NOT NULL UNIQUE,
  source_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.skill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES public.skill_identity(skill_id),
  source_key text NOT NULL,
  stable_slug text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  source_type text NOT NULL CHECK (source_type IN ('system_builtin', 'user_managed')),
  owner_local_operator_id uuid REFERENCES public.local_operator(local_operator_id),
  source_locator text NOT NULL,
  source_file_sha256 text,
  source_sha256 text NOT NULL,
  skill_name text NOT NULL CHECK (btrim(skill_name) <> ''),
  skill_category text NOT NULL CHECK (skill_category IN ('题材组合', '章节展开', '艺术呈现', '镜头语言')),
  skill_description text NOT NULL,
  genre_main jsonb,
  skill_tags_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  combo_logic jsonb,
  fun_source text,
  essence text,
  arc_structure jsonb,
  applicable_scene jsonb,
  ai_rating text CHECK (ai_rating IN ('SS', 'S', 'A', 'B', 'C')),
  applicable_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicable_scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  constraint_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_config_jsonb jsonb NOT NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('draft', 'active', 'archived')),
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (skill_id, version),
  UNIQUE (stable_slug, version),
  CHECK ((source_type = 'system_builtin' AND owner_local_operator_id IS NULL)
         OR (source_type = 'user_managed' AND owner_local_operator_id IS NOT NULL)),
  CHECK (
    skill_category <> '题材组合'
    OR genre_main->>'primary' IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')
  )
);

CREATE INDEX skill_active_idx
  ON public.skill(source_type, skill_category, lifecycle_status, stable_slug)
  WHERE lifecycle_status = 'active';
CREATE UNIQUE INDEX skill_one_active_version_uq
  ON public.skill(skill_id)
  WHERE lifecycle_status = 'active';
CREATE INDEX skill_tags_idx ON public.skill USING gin(skill_tags_jsonb);

CREATE TABLE public.book_skill_preference (
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  skill_id uuid NOT NULL REFERENCES public.skill_identity(skill_id),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  updated_by uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, skill_id)
);

ALTER TABLE public.iteration_log
  ADD CONSTRAINT iteration_log_skill_id_fk
  FOREIGN KEY (skill_id) REFERENCES public.skill_identity(skill_id);

CREATE TABLE public.prompt_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  fp_target text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  prompt_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'active', 'archived')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'active') = is_active),
  UNIQUE (local_operator_id, fp_target, version),
  UNIQUE (id, local_operator_id, fp_target, version)
);

CREATE UNIQUE INDEX prompt_one_active_uq
  ON public.prompt_config(local_operator_id, fp_target)
  WHERE is_active;

CREATE TABLE public.prompt_iteration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_config_id uuid NOT NULL REFERENCES public.prompt_config(id),
  change_type text NOT NULL,
  old_prompt_text text,
  new_prompt_text text NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.model_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  version integer NOT NULL CHECK (version > 0),
  model_name text NOT NULL,
  template_type text NOT NULL,
  provider_base_url text NOT NULL CHECK (btrim(provider_base_url) <> ''),
  api_key_ref text NOT NULL CHECK (btrim(api_key_ref) <> ''),
  routing_config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  parameters_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  is_active boolean NOT NULL DEFAULT false,
  connection_test_evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  CHECK ((status = 'active') = is_active),
  UNIQUE (local_operator_id, template_type, version)
);

CREATE UNIQUE INDEX model_one_active_uq
  ON public.model_sync_config(local_operator_id, template_type)
  WHERE is_active;
CREATE UNIQUE INDEX model_scope_version_uq
  ON public.model_sync_config(local_operator_id, template_type, version);

CREATE TABLE public.model_connection_test_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  provider_base_url text NOT NULL CHECK (btrim(provider_base_url) <> ''),
  model_name text NOT NULL CHECK (btrim(model_name) <> ''),
  api_key_ref_sha256 text NOT NULL CHECK (api_key_ref_sha256 ~ '^[0-9a-f]{64}$'),
  test_succeeded boolean NOT NULL,
  result_metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  tested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, local_operator_id)
);

ALTER TABLE public.model_sync_config
  ADD CONSTRAINT model_sync_config_test_evidence_fk
  FOREIGN KEY (connection_test_evidence_id, local_operator_id)
  REFERENCES public.model_connection_test_evidence(id, local_operator_id);

CREATE TABLE public.model_runtime_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  node_code text NOT NULL,
  prompt_config_id uuid REFERENCES public.prompt_config(id),
  prompt_version integer,
  template_type text NOT NULL,
  temperature numeric(3,2) CHECK (temperature BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((prompt_config_id IS NULL) = (prompt_version IS NULL)),
  CONSTRAINT model_runtime_binding_prompt_scope_fk
    FOREIGN KEY (prompt_config_id, local_operator_id, node_code, prompt_version)
    REFERENCES public.prompt_config(id, local_operator_id, fp_target, version),
  UNIQUE (local_operator_id, node_code)
);

CREATE UNIQUE INDEX model_runtime_binding_scope_uq
  ON public.model_runtime_binding(local_operator_id, node_code);

CREATE TABLE public.product_request_log (
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  book_id uuid REFERENCES public.book_project(id),
  intent jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation, local_operator_id, idempotency_key)
);

INSERT INTO public.skill_identity(skill_id, stable_slug, source_key)
SELECT DISTINCT s.skill_id,
       COALESCE(s.stable_slug, 'builtin-' || COALESCE(s.skill_config_jsonb->'raw_source'->>'id', s.skill_id::text)),
       'builtin:skill-library:'
       || COALESCE(s.skill_category, 'unknown')
       || ':'
       || COALESCE(s.skill_config_jsonb->'raw_source'->>'id', s.stable_slug, s.skill_id::text)
FROM _v7_skill_seed AS s;

INSERT INTO public.skill (
  id, skill_id, source_key, stable_slug, version, source_type,
  owner_local_operator_id, source_locator, source_file_sha256, source_sha256,
  skill_name, skill_category, skill_description, genre_main, skill_tags_jsonb,
  combo_logic, fun_source, essence, arc_structure, applicable_scene, ai_rating,
  applicable_stages, applicable_scopes, constraint_fields, template_fields,
  skill_config_jsonb, lifecycle_status, created_at, updated_at
)
SELECT
  s.id,
  s.skill_id,
  'builtin:skill-library:' || s.skill_category || ':' || (r.raw->>'id'),
  s.stable_slug,
  s.version,
  'system_builtin',
  NULL,
  s.source_locator,
  'e8dae19b8d83c1bc52bb51954f0c327c00e48699e55564b223da8f571835a6ef',
  encode(digest(convert_to(r.raw::text, 'UTF8'), 'sha256'), 'hex'),
  s.skill_name,
  s.skill_category,
  s.skill_description,
  CASE
    WHEN s.skill_category = '题材组合'
      AND r.raw->>'tag' IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')
      THEN jsonb_build_object('primary', r.raw->>'tag')
    ELSE NULL
  END,
  CASE WHEN r.raw ? 'tag' THEN jsonb_build_array(r.raw->>'tag') ELSE '[]'::jsonb END,
  CASE
    WHEN s.skill_category = '题材组合' THEN jsonb_strip_nulls(jsonb_build_object(
      'primary', r.raw->>'tag',
      'sub_genres', r.raw->>'subGenres',
      'logic', r.raw->>'logic'
    ))
    WHEN r.raw ? 'logic' THEN jsonb_build_object('logic', r.raw->>'logic')
    ELSE NULL
  END,
  r.raw->>'attraction',
  r.raw->>'essence',
  CASE WHEN r.raw ? 'arc' THEN jsonb_build_object('arc', r.raw->>'arc', 'key_point', r.raw->>'keyPoint') ELSE NULL END,
  CASE WHEN r.raw ? 'scene' THEN jsonb_build_object('scene', r.raw->>'scene') ELSE NULL END,
  r.raw->>'rating',
  COALESCE(s.applicable_stages, '[]'::jsonb),
  COALESCE(s.applicable_scopes, '{}'::jsonb),
  COALESCE(s.constraint_fields, '{}'::jsonb),
  COALESCE(s.template_fields, '{}'::jsonb),
  s.skill_config_jsonb,
  'active',
  COALESCE(s.created_at, clock_timestamp()),
  COALESCE(s.updated_at, clock_timestamp())
FROM _v7_skill_seed AS s
CROSS JOIN LATERAL (
  SELECT COALESCE(s.skill_config_jsonb->'raw_source', '{}'::jsonb) AS raw
) AS r;

DO $$
DECLARE
  v_total integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.skill
  WHERE source_type = 'system_builtin' AND lifecycle_status = 'active';
  IF v_total <> 72 THEN
    RAISE EXCEPTION 'V7_SKILL_SEED_REQUIRED: expected 72 approved system_builtin skills';
  END IF;
  IF (SELECT count(*) FROM public.skill WHERE source_type = 'system_builtin' AND lifecycle_status = 'active' AND skill_category = '题材组合') <> 54
     OR (SELECT count(*) FROM public.skill WHERE source_type = 'system_builtin' AND lifecycle_status = 'active' AND skill_category = '章节展开') <> 8
     OR (SELECT count(*) FROM public.skill WHERE source_type = 'system_builtin' AND lifecycle_status = 'active' AND skill_category = '艺术呈现') <> 6
     OR (SELECT count(*) FROM public.skill WHERE source_type = 'system_builtin' AND lifecycle_status = 'active' AND skill_category = '镜头语言') <> 4 THEN
    RAISE EXCEPTION 'V7_SKILL_SEED_CATEGORY_REQUIRED: expected 54/8/6/4 approved system_builtin skills';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.skill
    WHERE source_type = 'system_builtin'
      AND lifecycle_status = 'active'
      AND skill_category = '题材组合'
      AND genre_main IS NOT NULL
      AND COALESCE(genre_main->>'primary', '') NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')
  ) THEN
    RAISE EXCEPTION 'V7_SKILL_SEED_PRIMARY_GENRE_REJECTED: mapped builtin genres must use the creator-approved primary vocabulary';
  END IF;
END;
$$;

INSERT INTO public.v7_install_metadata(install_key, description) VALUES
  ('v7-data-rpc-contract', 'V7 PostgreSQL data and RPC contract installed'),
  ('v7-skill-default-data-sha256', 'e8dae19b8d83c1bc52bb51954f0c327c00e48699e55564b223da8f571835a6ef');

CREATE OR REPLACE FUNCTION public.v7_error(p_code text, p_message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'ok', false,
    'error', jsonb_build_object('code', p_code, 'message', p_message)
  );
$$;

CREATE OR REPLACE FUNCTION public.v7_allowed_model_credential_ref(p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(COALESCE(p_ref, '')) IN (
    'n8n-credential:openai-account-v1',
    'n8n-credential:relaycove-v1'
  );
$$;

CREATE OR REPLACE FUNCTION public.v7_normalize_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(COALESCE(p_title, ''))), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.v7_assert_operator(p_operator_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.local_operator
    WHERE local_operator_id = p_operator_id
  );
$$;

CREATE OR REPLACE FUNCTION public.v7_assert_book(p_operator_id uuid, p_book_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.book_project
    WHERE id = p_book_id
      AND local_operator_id = p_operator_id
  );
$$;

CREATE OR REPLACE FUNCTION public.v7_design_editable(p_book_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.l1a_unit
    WHERE book_id = p_book_id
      AND is_locked
      AND is_valid
      AND NOT is_shadow
  );
$$;

CREATE OR REPLACE FUNCTION public.v7_enable_internal_write()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('v7.internal_write', 'on', true);
END;
$$;

REVOKE ALL ON FUNCTION public.v7_enable_internal_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.v7_record_model_connection_test(
  p_local_operator_id uuid,
  p_provider_base_url text,
  p_model_name text,
  p_api_key_ref text,
  p_test_succeeded boolean,
  p_result_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_safe_metadata jsonb;
BEGIN
  IF NOT public.v7_assert_operator(p_local_operator_id)
     OR COALESCE(btrim(p_provider_base_url), '') = ''
     OR COALESCE(btrim(p_model_name), '') = ''
     OR COALESCE(btrim(p_api_key_ref), '') = ''
     OR NOT public.v7_allowed_model_credential_ref(p_api_key_ref)
     OR p_test_succeeded IS NULL THEN
    RAISE EXCEPTION 'V7_MODEL_CONNECTION_TEST_INVALID';
  END IF;

  -- Only non-sensitive diagnostic fields may cross from the controlled tester.
  v_safe_metadata := jsonb_strip_nulls(jsonb_build_object(
    'source', p_result_metadata->>'source',
    'http_status', p_result_metadata->>'http_status',
    'error_code', p_result_metadata->>'error_code'
  ));
  PERFORM public.v7_enable_internal_write();
  INSERT INTO public.model_connection_test_evidence(
    id, local_operator_id, provider_base_url, model_name,
    api_key_ref_sha256, test_succeeded, result_metadata_jsonb
  ) VALUES (
    v_id, p_local_operator_id, btrim(p_provider_base_url), btrim(p_model_name),
    encode(digest(convert_to(btrim(p_api_key_ref), 'UTF8'), 'sha256'), 'hex'),
    p_test_succeeded, v_safe_metadata
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.v7_record_model_connection_test(uuid, text, text, text, boolean, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.v7_model_config_test_evidence_valid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.model_connection_test_evidence AS e
    WHERE e.id = NEW.connection_test_evidence_id
      AND e.local_operator_id = NEW.local_operator_id
      AND e.test_succeeded
      AND e.provider_base_url = btrim(NEW.provider_base_url)
      AND e.model_name = btrim(NEW.model_name)
      AND e.api_key_ref_sha256 = encode(
        digest(convert_to(btrim(NEW.api_key_ref), 'UTF8'), 'sha256'), 'hex'
      )
  ) THEN
    RAISE EXCEPTION 'V7_MODEL_CONNECTION_TEST_EVIDENCE_REJECTED';
  END IF;
  IF NOT public.v7_allowed_model_credential_ref(NEW.api_key_ref) THEN
    RAISE EXCEPTION 'V7_MODEL_CREDENTIAL_REFERENCE_REJECTED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.v7_block_direct_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('v7.internal_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'V7_DIRECT_DML_BLOCKED: use the approved RPC or candidate write view';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.v7_block_direct_dml() IS
  'Business accidental-write guard only. It is not authentication, tenant isolation, or a privilege boundary for the database owner or a role able to set v7.internal_write.';

CREATE OR REPLACE FUNCTION public.v7_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.v7_audit_p0_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.has_p0_blocker IS DISTINCT FROM NEW.has_p0_blocker
     OR OLD.p0_items_json IS DISTINCT FROM NEW.p0_items_json
     OR OLD.audit_findings_jsonb IS DISTINCT FROM NEW.audit_findings_jsonb
     OR OLD.candidate_text_snapshot IS DISTINCT FROM NEW.candidate_text_snapshot
     OR OLD.return_route_suggestion_jsonb IS DISTINCT FROM NEW.return_route_suggestion_jsonb
     OR OLD.frozen_deduction_result_jsonb IS DISTINCT FROM NEW.frozen_deduction_result_jsonb
     OR OLD.audited_handoff_package_jsonb IS DISTINCT FROM NEW.audited_handoff_package_jsonb THEN
    RAISE EXCEPTION 'V7_P0_AUDIT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.v7_chapter_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.version_state = 'shadow' THEN
    RAISE EXCEPTION 'V7_CHAPTER_VERSION_IMMUTABLE';
  END IF;

  IF OLD.version_state = 'formal' AND NOT (
    NEW.version_state = 'shadow'
    AND NEW.is_shadow
    AND NOT NEW.is_formal
    AND NOT NEW.is_valid
    AND current_setting('v7.formal_rollback', true) = 'on'
  ) THEN
    RAISE EXCEPTION 'V7_CHAPTER_VERSION_IMMUTABLE';
  END IF;

  IF NEW.version_state NOT IN ('candidate', 'shadow', 'formal') THEN
    RAISE EXCEPTION 'V7_INVALID_CHAPTER_VERSION_STATE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.v7_valid_idempotency_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_key, '') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
$$;

CREATE OR REPLACE FUNCTION public.v7_count_han_and_punctuation(p_text text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT count(*)::integer
  FROM regexp_split_to_table(p_text, '') AS character_unit(character_value)
  WHERE ascii(character_value) BETWEEN 13312 AND 19903
     OR ascii(character_value) BETWEEN 19968 AND 40959
     OR ascii(character_value) BETWEEN 63744 AND 64255
     OR ascii(character_value) BETWEEN 131072 AND 191471
     OR character_value ~ '^[[:punct:]]$';
$$;

CREATE OR REPLACE FUNCTION public.v7_request_intent(p_request jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_request, '{}'::jsonb) - 'correlation_id' - 'idempotency_key';
$$;

CREATE OR REPLACE FUNCTION public.v7_replay_product_request(
  p_operation text,
  p_key text,
  p_operator uuid,
  p_book uuid,
  p_intent jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_book uuid;
  v_intent jsonb;
  v_result jsonb;
BEGIN
  SELECT book_id, intent, result
  INTO v_book, v_intent, v_result
  FROM public.product_request_log
  WHERE operation = p_operation
    AND local_operator_id = p_operator
    AND idempotency_key = p_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (p_book IS NOT NULL AND v_book IS DISTINCT FROM p_book)
     OR v_intent IS DISTINCT FROM p_intent THEN
    RETURN public.v7_error(
      'IDEMPOTENCY_CONFLICT',
      'The idempotency key is already bound to a different request in this operation scope.'
    );
  END IF;
  RETURN v_result || jsonb_build_object('idempotent_replay', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.v7_formal_design_fingerprint(p_book uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(digest(convert_to(jsonb_build_object(
    'world', COALESCE((
      SELECT jsonb_agg(to_jsonb(ws) - 'created_at' - 'updated_at' ORDER BY ws.id)
      FROM public.world_state AS ws
      WHERE ws.book_id = p_book AND ws.is_formal AND ws.is_valid AND NOT ws.is_shadow
    ), '[]'::jsonb),
    'bindings', COALESCE((
      SELECT jsonb_agg(to_jsonb(wb) - 'created_at' - 'updated_at' ORDER BY wb.id)
      FROM public.world_binding AS wb
      WHERE wb.book_id = p_book AND wb.is_formal AND wb.is_valid AND NOT wb.is_shadow
    ), '[]'::jsonb),
    'characters', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' ORDER BY c.id)
      FROM public.character AS c
      WHERE c.book_id = p_book AND c.is_formal AND c.is_valid AND NOT c.is_shadow
    ), '[]'::jsonb),
    'relations', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) - 'created_at' - 'updated_at' ORDER BY r.id)
      FROM public.relation_state AS r
      WHERE r.book_id = p_book AND r.is_formal AND r.is_valid AND NOT r.is_shadow
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.v7_runtime_binding_prompt_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.prompt_config_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.prompt_config AS p
    WHERE p.id = NEW.prompt_config_id
      AND p.local_operator_id = NEW.local_operator_id
      AND p.fp_target = NEW.node_code
      AND p.version = NEW.prompt_version
      AND p.status = 'active'
      AND p.is_active
  ) THEN
    RAISE EXCEPTION 'V7_RUNTIME_BINDING_PROMPT_REJECTED: a binding must reference the active global prompt for its local operator and FP';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'local_operator', 'book_project', 'l1a_unit', 'world_state', 'world_binding',
    'character', 'relation_state', 'chapter_header', 'chapter_version', 'writeback_log',
    'character_live_state', 'character_memory', 'character_writeback_log',
    'relation_state_log', 'audit_attempt_log', 'narrative_asset', 'editor_log',
    'iteration_log', 'vector_index_log', 'retrieval_snapshot', 'world_knowledge_entry',
    'skill_identity', 'skill', 'book_skill_preference', 'prompt_config',
    'prompt_iteration_log', 'model_connection_test_evidence',
    'model_sync_config', 'model_runtime_binding',
    'product_request_log'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER v7_direct_dml_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.v7_block_direct_dml()',
      v_table
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'book_project', 'l1a_unit', 'world_state', 'world_binding', 'character',
    'relation_state', 'chapter_header', 'chapter_version', 'narrative_asset',
    'skill', 'model_runtime_binding'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER v7_touch_updated_at BEFORE UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.v7_touch_updated_at()',
      v_table
    );
  END LOOP;
END;
$$;

CREATE TRIGGER v7_audit_p0_immutable
BEFORE UPDATE ON public.audit_attempt_log
FOR EACH ROW EXECUTE FUNCTION public.v7_audit_p0_immutable();

CREATE TRIGGER v7_chapter_version_transition
BEFORE UPDATE ON public.chapter_version
FOR EACH ROW EXECUTE FUNCTION public.v7_chapter_version_transition();

CREATE TRIGGER v7_runtime_binding_prompt_active
BEFORE INSERT OR UPDATE OF prompt_config_id, prompt_version, local_operator_id, node_code
ON public.model_runtime_binding
FOR EACH ROW EXECUTE FUNCTION public.v7_runtime_binding_prompt_active();

CREATE TRIGGER v7_model_config_test_evidence_valid
BEFORE INSERT OR UPDATE OF local_operator_id, provider_base_url, model_name, api_key_ref, connection_test_evidence_id
ON public.model_sync_config
FOR EACH ROW EXECUTE FUNCTION public.v7_model_config_test_evidence_valid();

CREATE VIEW public.chapter AS
SELECT
  h.id,
  h.book_id,
  bp.local_operator_id,
  h.l1a_unit_id,
  h.chapter_index,
  h.title,
  h.status,
  h.run_status,
  h.is_finalized,
  h.confirmation_status,
  h.word_count,
  c.id AS candidate_version_id,
  f.id AS formal_version_id,
  COALESCE(c.target_snapshot_json, f.target_snapshot_json) AS target_snapshot_json,
  COALESCE(c.chapter_implementation_json, f.chapter_implementation_json) AS chapter_implementation_json,
  c.candidate_plot_sim_json,
  f.formal_plot_sim_json,
  c.deduction_progress_json,
  COALESCE(c.deduction_locked, f.deduction_locked, false) AS deduction_locked,
  c.prose_text AS candidate_text,
  f.prose_text AS formal_text,
  f.prose_summary AS formal_summary,
  c.shadow_sublimation_json,
  f.formal_sublimation_json,
  COALESCE(c.exception_summary_jsonb, f.exception_summary_jsonb) AS exception_summary_jsonb,
  COALESCE(c.sublimation_type, f.sublimation_type) AS sublimation_type,
  c.review_decision,
  c.review_comment,
  false AS is_shadow,
  h.is_finalized AS is_formal,
  true AS is_valid,
  h.created_at,
  h.updated_at
FROM public.chapter_header AS h
JOIN public.book_project AS bp ON bp.id = h.book_id
LEFT JOIN public.chapter_version AS c
  ON c.chapter_id = h.id AND c.version_state = 'candidate'
LEFT JOIN public.chapter_version AS f
  ON f.chapter_id = h.id AND f.version_state = 'formal';

CREATE VIEW public.v_chapter_progress AS
SELECT
  h.id AS chapter_id,
  h.book_id,
  bp.local_operator_id,
  h.l1a_unit_id,
  h.chapter_index,
  h.status,
  h.run_status,
  c.id AS candidate_version_id,
  c.deduction_progress_json,
  c.deduction_locked,
  h.updated_at
FROM public.chapter_header AS h
JOIN public.book_project AS bp ON bp.id = h.book_id
JOIN public.chapter_version AS c
  ON c.chapter_id = h.id AND c.version_state = 'candidate';

CREATE VIEW public.v_world_state_active AS
SELECT ws.*, bp.local_operator_id
FROM public.world_state AS ws
JOIN public.book_project AS bp ON bp.id = ws.book_id
WHERE ws.is_active
  AND ws.is_formal
  AND ws.is_valid
  AND NOT ws.is_shadow;

CREATE VIEW public.v_world_assets_for_exec AS
SELECT ws.*, bp.local_operator_id
FROM public.world_state AS ws
JOIN public.book_project AS bp ON bp.id = ws.book_id
WHERE ws.setting_layer = 'initial'
  AND ws.is_active
  AND ws.is_formal
  AND ws.is_valid
  AND NOT ws.is_shadow;

CREATE VIEW public.v_narrative_asset_formal AS
SELECT na.*, bp.local_operator_id
FROM public.narrative_asset AS na
JOIN public.book_project AS bp ON bp.id = na.book_id
WHERE na.is_formal
  AND na.is_valid
  AND NOT na.is_shadow;

CREATE VIEW public.v_character_active AS
SELECT
  c.*,
  bp.local_operator_id,
  s.id AS live_state_id,
  s.philosophy_live_json,
  s.emotion_state_json,
  s.drive_live_json,
  s.trigger_state_json,
  s.goal_state_json,
  s.pressure_level,
  s.current_goal_txt,
  s.current_emo_tag
FROM public.character AS c
JOIN public.book_project AS bp ON bp.id = c.book_id
LEFT JOIN LATERAL (
  SELECT cls.*
  FROM public.character_live_state AS cls
  WHERE cls.character_id = c.id
    AND cls.is_formal
    AND cls.is_valid
    AND NOT cls.is_shadow
  ORDER BY cls.created_at DESC
  LIMIT 1
) AS s ON true
WHERE c.is_active
  AND c.is_formal
  AND c.is_valid
  AND NOT c.is_shadow;

CREATE VIEW public.v_skill_effective AS
SELECT
  bp.id AS book_id,
  bp.local_operator_id,
  s.id AS skill_version_id,
  s.skill_id,
  s.source_key,
  s.stable_slug,
  s.version,
  s.source_type,
  s.owner_local_operator_id,
  s.skill_name,
  s.skill_category,
  s.skill_description,
  s.genre_main,
  s.skill_tags_jsonb,
  s.combo_logic,
  s.fun_source,
  s.essence,
  s.arc_structure,
  s.applicable_scene,
  s.ai_rating,
  s.skill_config_jsonb
FROM public.book_project AS bp
JOIN public.skill AS s
  ON s.lifecycle_status = 'active'
 AND (s.source_type = 'system_builtin' OR s.owner_local_operator_id = bp.local_operator_id)
LEFT JOIN public.book_skill_preference AS pref
  ON pref.book_id = bp.id AND pref.skill_id = s.skill_id
WHERE COALESCE(pref.status, 'active') <> 'disabled';

CREATE VIEW public.v_prompt_runtime_binding AS
SELECT
  b.local_operator_id,
  b.node_code,
  m.id AS model_config_id,
  m.version AS model_config_version,
  b.prompt_config_id,
  b.prompt_version,
  b.template_type,
  b.temperature,
  p.prompt_text,
  p.status AS prompt_status,
  m.model_name,
  m.provider_base_url,
  m.api_key_ref,
  m.routing_config_jsonb,
  m.parameters_jsonb
FROM public.model_runtime_binding AS b
JOIN public.model_sync_config AS m
  ON m.local_operator_id = b.local_operator_id
 AND m.template_type = b.template_type
 AND m.status = 'active'
 AND m.is_active
JOIN public.prompt_config AS p
  ON p.id = b.prompt_config_id
 AND p.local_operator_id = b.local_operator_id
 AND p.fp_target = b.node_code
 AND p.version = b.prompt_version
 AND p.status = 'active'
 AND p.is_active;

CREATE OR REPLACE FUNCTION public.v7_require_candidate_scope(
  p_operator_id uuid,
  p_book_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize every design candidate mutation with FP004-04 before checking
  -- the freeze state, so a successful pre-check cannot race finalization.
  PERFORM 1
  FROM public.book_project
  WHERE id = p_book_id
    AND local_operator_id = p_operator_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_SCOPE_REJECTED';
  END IF;
  IF NOT public.v7_design_editable(p_book_id) THEN
    RAISE EXCEPTION 'V7_DESIGN_LOCKED_AFTER_L1A_CONFIRMATION';
  END IF;
END;
$$;

CREATE VIEW api.v_world_candidate_write AS
SELECT ws.*, bp.local_operator_id
FROM public.world_state AS ws
JOIN public.book_project AS bp ON bp.id = ws.book_id
WHERE NOT ws.is_formal AND ws.is_valid AND NOT ws.is_shadow;

CREATE OR REPLACE FUNCTION api.v_world_candidate_write_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_id uuid;
  v_revision integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.v7_require_candidate_scope(NEW.local_operator_id, NEW.book_id);
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT revision_no + 1 INTO v_revision
      FROM public.world_state
      WHERE id = NEW.supersedes_id AND book_id = NEW.book_id;
      IF v_revision IS NULL THEN
        RAISE EXCEPTION 'V7_WORLD_SUPERSEDES_SCOPE_REJECTED';
      END IF;
    ELSE
      v_revision := COALESCE(NEW.revision_no, 1);
    END IF;
    v_id := COALESCE(NEW.id, gen_random_uuid());
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.world_state (
      id, book_id, revision_no, supersedes_id, board_type, atom_type, atom_key,
      atom_value_jsonb, affordance_dims, source_type, setting_layer, origin_l1a_id,
      is_active, is_formal, is_shadow, is_valid, knowledge_boundary_json,
      apply_scope_json, violate_cost_json, chain_change_json, reverse_dep_index,
      reveal_order, l1a_change_log_json, gen_l1a_json, conflict_with_initial
    ) VALUES (
      v_id, NEW.book_id, v_revision, NEW.supersedes_id, NEW.board_type, NEW.atom_type,
      NEW.atom_key, NEW.atom_value_jsonb, COALESCE(NEW.affordance_dims, '[]'::jsonb),
      NEW.source_type, NEW.setting_layer, NEW.origin_l1a_id,
      false, false, false, true, NEW.knowledge_boundary_json,
      NEW.apply_scope_json, NEW.violate_cost_json, NEW.chain_change_json,
      NEW.reverse_dep_index, NEW.reveal_order, NEW.l1a_change_log_json,
      NEW.gen_l1a_json, NEW.conflict_with_initial
    );
    NEW.id := v_id;
    NEW.revision_no := v_revision;
    NEW.is_active := false;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
    IF NEW.book_id IS DISTINCT FROM OLD.book_id
       OR NEW.local_operator_id IS DISTINCT FROM OLD.local_operator_id THEN
      RAISE EXCEPTION 'V7_CANDIDATE_SCOPE_IMMUTABLE';
    END IF;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.world_state
    SET board_type = NEW.board_type,
        atom_type = NEW.atom_type,
        atom_key = NEW.atom_key,
        atom_value_jsonb = NEW.atom_value_jsonb,
        affordance_dims = COALESCE(NEW.affordance_dims, '[]'::jsonb),
        source_type = NEW.source_type,
        setting_layer = NEW.setting_layer,
        origin_l1a_id = NEW.origin_l1a_id,
        knowledge_boundary_json = NEW.knowledge_boundary_json,
        apply_scope_json = NEW.apply_scope_json,
        violate_cost_json = NEW.violate_cost_json,
        chain_change_json = NEW.chain_change_json,
        reverse_dep_index = NEW.reverse_dep_index,
        reveal_order = NEW.reveal_order,
        l1a_change_log_json = NEW.l1a_change_log_json,
        gen_l1a_json = NEW.gen_l1a_json,
        conflict_with_initial = NEW.conflict_with_initial,
        is_active = false,
        is_formal = false,
        is_shadow = false,
        is_valid = true
    WHERE id = OLD.id
      AND NOT is_formal AND is_valid AND NOT is_shadow;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
    END IF;
    NEW.is_active := false;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  END IF;

  PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
  PERFORM public.v7_enable_internal_write();
  DELETE FROM public.world_state
  WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER v_world_candidate_write_dml
INSTEAD OF INSERT OR UPDATE OR DELETE ON api.v_world_candidate_write
FOR EACH ROW EXECUTE FUNCTION api.v_world_candidate_write_dml();

CREATE VIEW api.v_world_binding_candidate_write AS
SELECT wb.*, bp.local_operator_id
FROM public.world_binding AS wb
JOIN public.book_project AS bp ON bp.id = wb.book_id
WHERE NOT wb.is_formal AND wb.is_valid AND NOT wb.is_shadow;

CREATE OR REPLACE FUNCTION api.v_world_binding_candidate_write_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_id uuid;
  v_revision integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.v7_require_candidate_scope(NEW.local_operator_id, NEW.book_id);
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT revision_no + 1 INTO v_revision
      FROM public.world_binding
      WHERE id = NEW.supersedes_id AND book_id = NEW.book_id;
      IF v_revision IS NULL THEN
        RAISE EXCEPTION 'V7_BINDING_SUPERSEDES_SCOPE_REJECTED';
      END IF;
    ELSE
      v_revision := COALESCE(NEW.revision_no, 1);
    END IF;
    v_id := COALESCE(NEW.id, gen_random_uuid());
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.world_binding(
      id, book_id, revision_no, supersedes_id, from_ref_type, from_ref_id,
      to_ref_type, to_ref_id, binding_type, binding_strength, setting_layer,
      origin_l1a_id, is_formal, is_shadow, is_valid
    ) VALUES (
      v_id, NEW.book_id, v_revision, NEW.supersedes_id, NEW.from_ref_type,
      NEW.from_ref_id, NEW.to_ref_type, NEW.to_ref_id, NEW.binding_type,
      COALESCE(NEW.binding_strength, 'medium'), NEW.setting_layer, NEW.origin_l1a_id,
      false, false, true
    );
    NEW.id := v_id;
    NEW.revision_no := v_revision;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
    IF NEW.book_id IS DISTINCT FROM OLD.book_id
       OR NEW.local_operator_id IS DISTINCT FROM OLD.local_operator_id THEN
      RAISE EXCEPTION 'V7_CANDIDATE_SCOPE_IMMUTABLE';
    END IF;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.world_binding
    SET from_ref_type = NEW.from_ref_type,
        from_ref_id = NEW.from_ref_id,
        to_ref_type = NEW.to_ref_type,
        to_ref_id = NEW.to_ref_id,
        binding_type = NEW.binding_type,
        binding_strength = NEW.binding_strength,
        setting_layer = NEW.setting_layer,
        origin_l1a_id = NEW.origin_l1a_id,
        is_formal = false,
        is_shadow = false,
        is_valid = true
    WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
    END IF;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  END IF;

  PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
  PERFORM public.v7_enable_internal_write();
  DELETE FROM public.world_binding
  WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER v_world_binding_candidate_write_dml
INSTEAD OF INSERT OR UPDATE OR DELETE ON api.v_world_binding_candidate_write
FOR EACH ROW EXECUTE FUNCTION api.v_world_binding_candidate_write_dml();

CREATE VIEW api.v_character_candidate_write AS
SELECT c.*, bp.local_operator_id
FROM public.character AS c
JOIN public.book_project AS bp ON bp.id = c.book_id
WHERE NOT c.is_formal AND c.is_valid AND NOT c.is_shadow;

CREATE OR REPLACE FUNCTION api.v_character_candidate_write_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_id uuid;
  v_logical_id uuid;
  v_revision integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.v7_require_candidate_scope(NEW.local_operator_id, NEW.book_id);
    v_id := COALESCE(NEW.id, gen_random_uuid());
    v_logical_id := COALESCE(NEW.logical_character_id, v_id);
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT revision_no + 1, logical_character_id INTO v_revision, v_logical_id
      FROM public.character
      WHERE id = NEW.supersedes_id AND book_id = NEW.book_id;
      IF v_revision IS NULL THEN
        RAISE EXCEPTION 'V7_CHARACTER_SUPERSEDES_SCOPE_REJECTED';
      END IF;
    ELSE
      v_revision := COALESCE(NEW.revision_no, 1);
    END IF;
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.character(
      id, logical_character_id, book_id, revision_no, supersedes_id, char_name,
      five_layers_json, knowledge_boundary_json, arc_json, status, is_active,
      is_formal, is_shadow, is_valid, char_type, char_code, gender,
      cheat_hot_json, conflict_seed_json
    ) VALUES (
      v_id, v_logical_id, NEW.book_id, v_revision, NEW.supersedes_id, NEW.char_name,
      NEW.five_layers_json, NEW.knowledge_boundary_json, NEW.arc_json, 'candidate',
      COALESCE(NEW.is_active, true), false, false, true, NEW.char_type, NEW.char_code,
      NEW.gender, NEW.cheat_hot_json, NEW.conflict_seed_json
    );
    NEW.id := v_id;
    NEW.logical_character_id := v_logical_id;
    NEW.revision_no := v_revision;
    NEW.status := 'candidate';
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
    IF NEW.book_id IS DISTINCT FROM OLD.book_id
       OR NEW.local_operator_id IS DISTINCT FROM OLD.local_operator_id
       OR NEW.logical_character_id IS DISTINCT FROM OLD.logical_character_id THEN
      RAISE EXCEPTION 'V7_CANDIDATE_SCOPE_IMMUTABLE';
    END IF;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.character
    SET char_name = NEW.char_name,
        five_layers_json = NEW.five_layers_json,
        knowledge_boundary_json = NEW.knowledge_boundary_json,
        arc_json = NEW.arc_json,
        is_active = NEW.is_active,
        char_type = NEW.char_type,
        char_code = NEW.char_code,
        gender = NEW.gender,
        cheat_hot_json = NEW.cheat_hot_json,
        conflict_seed_json = NEW.conflict_seed_json,
        status = 'candidate',
        is_formal = false,
        is_shadow = false,
        is_valid = true
    WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
    END IF;
    NEW.status := 'candidate';
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  END IF;

  PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
  PERFORM public.v7_enable_internal_write();
  DELETE FROM public.character
  WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER v_character_candidate_write_dml
INSTEAD OF INSERT OR UPDATE OR DELETE ON api.v_character_candidate_write
FOR EACH ROW EXECUTE FUNCTION api.v_character_candidate_write_dml();

CREATE VIEW api.v_relation_candidate_write AS
SELECT r.*, bp.local_operator_id
FROM public.relation_state AS r
JOIN public.book_project AS bp ON bp.id = r.book_id
WHERE NOT r.is_formal AND r.is_valid AND NOT r.is_shadow;

CREATE OR REPLACE FUNCTION api.v_relation_candidate_write_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.v7_require_candidate_scope(NEW.local_operator_id, NEW.book_id);
    IF NOT EXISTS (
      SELECT 1
      FROM public.character AS c
      JOIN public.book_project AS bp ON bp.id = c.book_id
      WHERE c.id = NEW.char_a_id
        AND c.book_id = NEW.book_id
        AND bp.local_operator_id = NEW.local_operator_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM public.character AS c
      JOIN public.book_project AS bp ON bp.id = c.book_id
      WHERE c.id = NEW.char_b_id
        AND c.book_id = NEW.book_id
        AND bp.local_operator_id = NEW.local_operator_id
    ) THEN
      RAISE EXCEPTION 'V7_RELATION_CHARACTER_SCOPE_REJECTED';
    END IF;
    v_id := COALESCE(NEW.id, gen_random_uuid());
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.relation_state(
      id, book_id, char_a_id, char_b_id, trust, intimacy, power_balance,
      dependence, hostility, common_goal, secret_known, emotional_bond,
      relation_type, relation_hierarchy, relation_origin, relation_overview,
      change_event_json, is_formal, is_shadow, is_valid, support_level, source_chapter_id
    ) VALUES (
      v_id, NEW.book_id, NEW.char_a_id, NEW.char_b_id, NEW.trust, NEW.intimacy,
      NEW.power_balance, NEW.dependence, NEW.hostility, NEW.common_goal,
      NEW.secret_known, NEW.emotional_bond, NEW.relation_type, NEW.relation_hierarchy,
      NEW.relation_origin, NEW.relation_overview, NEW.change_event_json,
      false, false, true, NEW.support_level, NEW.source_chapter_id
    );
    NEW.id := v_id;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
    IF NEW.book_id IS DISTINCT FROM OLD.book_id
       OR NEW.local_operator_id IS DISTINCT FROM OLD.local_operator_id THEN
      RAISE EXCEPTION 'V7_CANDIDATE_SCOPE_IMMUTABLE';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.character AS c
      JOIN public.book_project AS bp ON bp.id = c.book_id
      WHERE c.id = NEW.char_a_id
        AND c.book_id = NEW.book_id
        AND bp.local_operator_id = NEW.local_operator_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM public.character AS c
      JOIN public.book_project AS bp ON bp.id = c.book_id
      WHERE c.id = NEW.char_b_id
        AND c.book_id = NEW.book_id
        AND bp.local_operator_id = NEW.local_operator_id
    ) THEN
      RAISE EXCEPTION 'V7_RELATION_CHARACTER_SCOPE_REJECTED';
    END IF;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.relation_state
    SET char_a_id = NEW.char_a_id,
        char_b_id = NEW.char_b_id,
        trust = NEW.trust,
        intimacy = NEW.intimacy,
        power_balance = NEW.power_balance,
        dependence = NEW.dependence,
        hostility = NEW.hostility,
        common_goal = NEW.common_goal,
        secret_known = NEW.secret_known,
        emotional_bond = NEW.emotional_bond,
        relation_type = NEW.relation_type,
        relation_hierarchy = NEW.relation_hierarchy,
        relation_origin = NEW.relation_origin,
        relation_overview = NEW.relation_overview,
        change_event_json = NEW.change_event_json,
        support_level = NEW.support_level,
        source_chapter_id = NEW.source_chapter_id,
        is_formal = false,
        is_shadow = false,
        is_valid = true
    WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
    END IF;
    NEW.is_formal := false;
    NEW.is_shadow := false;
    NEW.is_valid := true;
    RETURN NEW;
  END IF;

  PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
  PERFORM public.v7_enable_internal_write();
  DELETE FROM public.relation_state
  WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER v_relation_candidate_write_dml
INSTEAD OF INSERT OR UPDATE OR DELETE ON api.v_relation_candidate_write
FOR EACH ROW EXECUTE FUNCTION api.v_relation_candidate_write_dml();

CREATE VIEW api.v_l1a_candidate_write AS
SELECT l.*, bp.local_operator_id
FROM public.l1a_unit AS l
JOIN public.book_project AS bp ON bp.id = l.book_id
WHERE NOT l.is_formal AND l.is_valid AND NOT l.is_shadow AND NOT l.is_locked;

CREATE OR REPLACE FUNCTION api.v_l1a_candidate_write_dml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.v7_require_candidate_scope(NEW.local_operator_id, NEW.book_id);
    v_id := COALESCE(NEW.id, gen_random_uuid());
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.l1a_unit(
      id, book_id, l1a_index, l1a_name, scene_location, conflict_background, escalation_path,
      stakes, irreversible_consequence, plot_emotion_commit, arc_requirement,
      info_reveal_boundary, role_arc_json, chapter_nos_json, status, source_type,
      confirmation_status, is_shadow, is_formal, is_valid, is_locked, is_patch,
      need_regen, core_conflict_flag, mid_goals, world_progress_json,
      narrative_techniques, future_value_reserved, future_setting_seeds,
      world_resistance_refs, jinzhan, payoff, emotion_type, has_explicit_hook,
      consequences, escalation, related_hook, role_arcs, participant_chars_json,
      three_line_json, review_history_jsonb, return_direction
    ) VALUES (
      v_id, NEW.book_id, NEW.l1a_index, NEW.l1a_name, NEW.scene_location, NEW.conflict_background,
      NEW.escalation_path, NEW.stakes, NEW.irreversible_consequence,
      NEW.plot_emotion_commit, NEW.arc_requirement, NEW.info_reveal_boundary,
      NEW.role_arc_json, NEW.chapter_nos_json, COALESCE(NEW.status, 'candidate'),
      COALESCE(NEW.source_type, 'manual'), 'unconfirmed', false, false, true,
      false, COALESCE(NEW.is_patch, false), COALESCE(NEW.need_regen, false),
      COALESCE(NEW.core_conflict_flag, false), NEW.mid_goals, NEW.world_progress_json,
      NEW.narrative_techniques, NEW.future_value_reserved, NEW.future_setting_seeds,
      NEW.world_resistance_refs, NEW.jinzhan, NEW.payoff, NEW.emotion_type,
      COALESCE(NEW.has_explicit_hook, false), NEW.consequences, NEW.escalation,
      NEW.related_hook, COALESCE(NEW.role_arcs, '[]'::jsonb), NEW.participant_chars_json,
      NEW.three_line_json, COALESCE(NEW.review_history_jsonb, '[]'::jsonb), NEW.return_direction
    );
    NEW.id := v_id;
    NEW.confirmation_status := 'unconfirmed';
    NEW.is_shadow := false;
    NEW.is_formal := false;
    NEW.is_valid := true;
    NEW.is_locked := false;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
    IF NEW.book_id IS DISTINCT FROM OLD.book_id
       OR NEW.local_operator_id IS DISTINCT FROM OLD.local_operator_id THEN
      RAISE EXCEPTION 'V7_CANDIDATE_SCOPE_IMMUTABLE';
    END IF;
    IF NEW.status NOT IN ('candidate', 'sorted') THEN
      RAISE EXCEPTION 'V7_L1A_CANDIDATE_STATUS_REJECTED';
    END IF;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.l1a_unit
    SET l1a_index = NEW.l1a_index,
        l1a_name = NEW.l1a_name,
        scene_location = NEW.scene_location,
        conflict_background = NEW.conflict_background,
        escalation_path = NEW.escalation_path,
        stakes = NEW.stakes,
        irreversible_consequence = NEW.irreversible_consequence,
        plot_emotion_commit = NEW.plot_emotion_commit,
        arc_requirement = NEW.arc_requirement,
        info_reveal_boundary = NEW.info_reveal_boundary,
        role_arc_json = NEW.role_arc_json,
        chapter_nos_json = NEW.chapter_nos_json,
        status = NEW.status,
        source_type = NEW.source_type,
        is_patch = NEW.is_patch,
        need_regen = NEW.need_regen,
        core_conflict_flag = NEW.core_conflict_flag,
        mid_goals = NEW.mid_goals,
        world_progress_json = NEW.world_progress_json,
        narrative_techniques = NEW.narrative_techniques,
        future_value_reserved = NEW.future_value_reserved,
        future_setting_seeds = NEW.future_setting_seeds,
        world_resistance_refs = NEW.world_resistance_refs,
        jinzhan = NEW.jinzhan,
        payoff = NEW.payoff,
        emotion_type = NEW.emotion_type,
        has_explicit_hook = NEW.has_explicit_hook,
        consequences = NEW.consequences,
        escalation = NEW.escalation,
        related_hook = NEW.related_hook,
        role_arcs = NEW.role_arcs,
        participant_chars_json = NEW.participant_chars_json,
        three_line_json = NEW.three_line_json,
        review_history_jsonb = NEW.review_history_jsonb,
        return_direction = NEW.return_direction
    WHERE id = OLD.id
      AND NOT is_formal AND is_valid AND NOT is_shadow AND NOT is_locked;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM public.v7_require_candidate_scope(OLD.local_operator_id, OLD.book_id);
  PERFORM public.v7_enable_internal_write();
  DELETE FROM public.l1a_unit
  WHERE id = OLD.id AND NOT is_formal AND is_valid AND NOT is_shadow AND NOT is_locked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_CANDIDATE_NOT_WRITABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER v_l1a_candidate_write_dml
INSTEAD OF INSERT OR UPDATE OR DELETE ON api.v_l1a_candidate_write
FOR EACH ROW EXECUTE FUNCTION api.v_l1a_candidate_write_dml();

CREATE OR REPLACE FUNCTION public.rpc_get_local_operator(p_request jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_requested uuid;
BEGIN
  BEGIN
    v_requested := NULLIF(p_request->>'local_operator_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id must be a UUID when supplied.');
  END;

  SELECT local_operator_id INTO v_existing
  FROM public.local_operator
  WHERE singleton_key;

  IF v_existing IS NOT NULL THEN
    IF v_requested IS NOT NULL AND v_requested <> v_existing THEN
      RETURN public.v7_error('LOCAL_OPERATOR_MISMATCH', 'This installation already has a different local operator.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'local_operator_id', v_existing);
  END IF;

  v_existing := COALESCE(v_requested, gen_random_uuid());
  PERFORM public.v7_enable_internal_write();
  INSERT INTO public.local_operator(singleton_key, local_operator_id)
  VALUES (true, v_existing);

  RETURN jsonb_build_object('ok', true, 'local_operator_id', v_existing, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_create_book_project(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid := gen_random_uuid();
  v_title text := btrim(COALESCE(p_request->>'title', ''));
  v_normalized_title text;
  v_genre text;
  v_nested_genre text;
  v_legacy_genre text;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_char jsonb;
  v_world jsonb;
  v_relation jsonb;
  v_binding jsonb;
  v_memory jsonb;
  v_l1a jsonb := p_request->'initial_l1a';
  v_char_id uuid;
  v_l1a_id uuid := gen_random_uuid();
  v_ref text;
  v_a_ref text;
  v_b_ref text;
  v_resource_ref text;
  v_char_map jsonb := '{}'::jsonb;
  v_char_refs text[] := ARRAY[]::text[];
  v_world_keys text[] := ARRAY[]::text[];
  v_required_world_fields text[];
  v_relation_pairs text[] := ARRAY[]::text[];
  v_relation_pair text;
  v_participants jsonb := '[]'::jsonb;
  v_participant_ref text;
  v_board_set jsonb := '{}'::jsonb;
  v_required_boards text[] := ARRAY['rule', 'geography', 'resource', 'faction', 'profession', 'monster', 'event'];
  v_world_ids jsonb := '[]'::jsonb;
  v_char_ids jsonb := '[]'::jsonb;
  v_relation_ids jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id must be a UUID.');
  END;

  IF NOT public.v7_assert_operator(v_operator) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The local operator is not available on this installation.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_create_book_project', v_key, v_operator, NULL, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  v_normalized_title := public.v7_normalize_title(v_title);
  IF v_normalized_title = '' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A book title is required.');
  END IF;
  IF jsonb_typeof(p_request->'intent_json') IS DISTINCT FROM 'object'
     OR p_request->'intent_json' = '{}'::jsonb
     OR jsonb_typeof(p_request->'forbid_json') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_request->'selling_points_json') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'selling_points_json') = 0
     OR COALESCE(p_request->>'target_words', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_request->>'chapter_words', '') !~ '^[1-9][0-9]*$' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'intent_json and forbid_json are required.');
  END IF;
  IF NULLIF(btrim(p_request #>> '{intent_json,target_emotion}'), '') IS NULL THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'A target emotion is required.');
  END IF;
  v_nested_genre := NULLIF(btrim(p_request #>> '{intent_json,genre_main}'), '');
  v_legacy_genre := NULLIF(btrim(p_request->>'genre_main'), '');
  IF v_nested_genre IS NOT NULL
     AND v_legacy_genre IS NOT NULL
     AND v_nested_genre IS DISTINCT FROM v_legacy_genre THEN
    RETURN public.v7_error('INVALID_REQUEST', 'genre_main conflicts with intent_json.genre_main.');
  END IF;
  v_genre := COALESCE(v_nested_genre, v_legacy_genre);
  IF COALESCE(v_genre, '') NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'intent_json.genre_main must be one of the six approved primary genres.');
  END IF;
  IF jsonb_typeof(p_request->'characters') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'characters') = 0 THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'At least one complete initial character is required.');
  END IF;
  IF jsonb_typeof(p_request->'world_states') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'world_states') = 0 THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'All seven initial world boards are required.');
  END IF;
  IF jsonb_typeof(v_l1a) IS DISTINCT FROM 'object' THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'An initial L1A commitment is required.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.book_project
    WHERE local_operator_id = v_operator AND normalized_title = v_normalized_title
  ) THEN
    RETURN public.v7_error('DUPLICATE_TITLE', 'A book with this title already exists for this local operator.');
  END IF;

  -- Validate every item before any row is written so an ordinary validation
  -- failure never leaves a partial book behind.
  FOR v_char IN SELECT value FROM jsonb_array_elements(p_request->'characters')
  LOOP
    v_ref := COALESCE(v_char->>'client_ref', v_char->>'char_code');
    IF COALESCE(v_ref, '') = ''
       OR COALESCE(v_char->>'char_name', '') = ''
       OR COALESCE(v_char->>'char_type', '') NOT IN ('protagonist', 'supporting', 'ensemble', 'antagonist')
       OR jsonb_typeof(v_char->'five_layers_json') IS DISTINCT FROM 'object'
       OR NOT (v_char->'five_layers_json' ?& ARRAY['L0', 'L1', 'L2', 'L3'])
       OR EXISTS (
         SELECT 1
         FROM unnest(ARRAY['L0', 'L1', 'L2', 'L3']) AS layer_name
         WHERE jsonb_typeof(v_char->'five_layers_json'->layer_name) IS DISTINCT FROM 'object'
            OR v_char->'five_layers_json'->layer_name = '{}'::jsonb
       )
       OR jsonb_typeof(v_char->'knowledge_boundary_json') IS DISTINCT FROM 'object'
       OR NOT (v_char->'knowledge_boundary_json' ?& ARRAY['knows', 'unknown', 'false_belief', 'reasonable_suspect'])
       OR EXISTS (
         SELECT 1
         FROM unnest(ARRAY['knows', 'unknown', 'false_belief', 'reasonable_suspect']) AS quadrant_name
         WHERE jsonb_typeof(v_char->'knowledge_boundary_json'->quadrant_name) IS DISTINCT FROM 'array'
       )
       OR jsonb_typeof(v_char->'arc_json') IS DISTINCT FROM 'object'
       OR v_char->'arc_json' = '{}'::jsonb THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial character needs a client_ref, L0-L3, knowledge quadrants, and arc_json.');
    END IF;
    IF v_ref = ANY(v_char_refs) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'Character client_ref values must be unique.');
    END IF;
    v_char_refs := array_append(v_char_refs, v_ref);
  END LOOP;

  FOR v_relation IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'relations', '[]'::jsonb))
  LOOP
    v_a_ref := v_relation->>'char_a_ref';
    v_b_ref := v_relation->>'char_b_ref';
    v_relation_pair := CASE WHEN v_a_ref < v_b_ref THEN v_a_ref || ':' || v_b_ref ELSE v_b_ref || ':' || v_a_ref END;
    IF v_a_ref IS NULL OR v_b_ref IS NULL
       OR v_a_ref = v_b_ref
       OR NOT (v_a_ref = ANY(v_char_refs))
       OR NOT (v_b_ref = ANY(v_char_refs))
       OR v_relation_pair = ANY(v_relation_pairs)
       OR NOT (v_relation ?& ARRAY[
         'trust', 'intimacy', 'power_balance', 'dependence',
         'hostility', 'common_goal', 'secret_known', 'emotional_bond'
       ])
       OR EXISTS (
         SELECT 1
         FROM unnest(ARRAY[
           'trust', 'intimacy', 'power_balance', 'dependence',
           'hostility', 'common_goal', 'secret_known', 'emotional_bond'
         ]) AS dimension_name
         WHERE COALESCE(v_relation->>dimension_name, '') !~ '^-?[0-9]+$'
       )
       OR COALESCE(btrim(v_relation->>'relation_type'), '') = ''
       OR COALESCE(btrim(v_relation->>'relation_hierarchy'), '') = ''
       OR jsonb_typeof(v_relation->'change_event_json') IS DISTINCT FROM 'object'
       OR v_relation->'change_event_json' = '{}'::jsonb THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial relation must reference two initial characters and one event.');
    END IF;
    IF (v_relation->>'trust')::integer NOT BETWEEN -100 AND 100
       OR (v_relation->>'intimacy')::integer NOT BETWEEN -100 AND 100
       OR (v_relation->>'power_balance')::integer NOT BETWEEN -100 AND 100
       OR (v_relation->>'dependence')::integer NOT BETWEEN -100 AND 100
       OR (v_relation->>'hostility')::integer NOT BETWEEN 0 AND 100
       OR (v_relation->>'common_goal')::integer NOT BETWEEN 0 AND 100
       OR (v_relation->>'secret_known')::integer NOT BETWEEN 0 AND 100
       OR (v_relation->>'emotional_bond')::integer NOT BETWEEN -100 AND 100 THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial relation dimension must stay inside its V7 range.');
    END IF;
    v_relation_pairs := array_append(v_relation_pairs, v_relation_pair);
  END LOOP;

  FOR v_memory IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'initial_memories', '[]'::jsonb))
  LOOP
    IF NOT ((v_memory->>'char_ref') = ANY(v_char_refs))
       OR COALESCE(v_memory->>'memory_type', '') NOT IN ('event', 'emotion', 'knowledge', 'relationship')
       OR COALESCE(v_memory->>'truth_status', '') NOT IN ('true', 'misremembered', 'false')
       OR COALESCE(v_memory->>'memory_content', '') = ''
       OR (v_memory ? 'importance' AND COALESCE(v_memory->>'importance', '') !~ '^(0(\.[0-9]+)?|1(\.0+)?)$')
       OR (v_memory ? 'decay_rate' AND COALESCE(v_memory->>'decay_rate', '') !~ '^(0(\.[0-9]+)?|1(\.0+)?)$') THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'An initial memory must reference an initial character and contain content.');
    END IF;
    IF (v_memory ? 'importance' AND (v_memory->>'importance')::numeric NOT BETWEEN 0 AND 1)
       OR (v_memory ? 'decay_rate' AND (v_memory->>'decay_rate')::numeric NOT BETWEEN 0 AND 1) THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Initial memory importance and decay_rate must stay between zero and one.');
    END IF;
  END LOOP;

  FOR v_world IN SELECT value FROM jsonb_array_elements(p_request->'world_states')
  LOOP
    v_required_world_fields := CASE v_world->>'board_type'
      WHEN 'rule' THEN ARRAY['violate_cost', 'apply_scope', 'rule_type']::text[]
      WHEN 'geography' THEN ARRAY['danger_level', 'location_text']::text[]
      WHEN 'resource' THEN ARRAY['scarcity_level', 'usability']::text[]
      WHEN 'faction' THEN ARRAY['faction_status', 'stance']::text[]
      WHEN 'profession' THEN ARRAY['cost_mechanism', 'is_system']::text[]
      WHEN 'monster' THEN ARRAY['threat_level', 'counter_text']::text[]
      WHEN 'event' THEN ARRAY['event_era']::text[]
      ELSE ARRAY[]::text[]
    END;
    IF COALESCE(v_world->>'board_type', '') = ''
       OR COALESCE(v_world->>'board_type', '') NOT IN ('rule', 'geography', 'resource', 'faction', 'profession', 'monster', 'event')
       OR COALESCE(v_world->>'atom_type', '') = ''
       OR COALESCE(v_world->>'atom_type', '') NOT IN ('rule', 'fact', 'resource', 'event', 'faction', 'job', 'monster', 'geo')
       OR COALESCE(v_world->>'atom_key', '') = ''
       OR v_world->>'atom_key' = ANY(v_world_keys)
       OR jsonb_typeof(v_world->'atom_value_jsonb') IS DISTINCT FROM 'object'
       OR v_world->'atom_value_jsonb' = '{}'::jsonb
       OR jsonb_typeof(v_world->'affordance_dims') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_world->'affordance_dims') = 0
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_world->'affordance_dims') AS dimension(value)
         WHERE jsonb_typeof(dimension.value) <> 'string'
            OR btrim(dimension.value #>> '{}') = ''
       )
       OR (v_world->>'atom_type' = 'fact' AND jsonb_typeof(v_world->'knowledge_boundary_json') IS DISTINCT FROM 'object') THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial world item needs its board, atom key, value, and affordance dimensions.');
    END IF;
    IF NOT (v_world->'atom_value_jsonb' ?& v_required_world_fields)
       OR EXISTS (
         SELECT 1
         FROM unnest(v_required_world_fields) AS required(field_name)
         WHERE jsonb_typeof(v_world->'atom_value_jsonb'->required.field_name) = 'null'
            OR (jsonb_typeof(v_world->'atom_value_jsonb'->required.field_name) = 'string'
                AND btrim(v_world->'atom_value_jsonb'->>required.field_name) = '')
            OR (jsonb_typeof(v_world->'atom_value_jsonb'->required.field_name) = 'array'
                AND jsonb_array_length(v_world->'atom_value_jsonb'->required.field_name) = 0)
            OR (jsonb_typeof(v_world->'atom_value_jsonb'->required.field_name) = 'object'
                AND v_world->'atom_value_jsonb'->required.field_name = '{}'::jsonb)
       ) THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial world item needs the required L1 fields for its board.');
    END IF;
    v_world_keys := array_append(v_world_keys, v_world->>'atom_key');
    v_board_set := v_board_set || jsonb_build_object(v_world->>'board_type', true);
  END LOOP;
  IF NOT (v_board_set ?& v_required_boards) THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'The initial world must include rule, geography, resource, faction, profession, monster, and event boards.');
  END IF;

  FOR v_binding IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'world_bindings', '[]'::jsonb))
  LOOP
    IF COALESCE(v_binding->>'from_ref_type', '') NOT IN ('world', 'character')
       OR COALESCE(v_binding->>'to_ref_type', '') NOT IN ('world', 'character')
       OR COALESCE(btrim(v_binding->>'from_ref_id'), '') = ''
       OR COALESCE(btrim(v_binding->>'to_ref_id'), '') = ''
       OR COALESCE(btrim(v_binding->>'binding_type'), '') = ''
       OR COALESCE(v_binding->>'binding_strength', '中') NOT IN ('strong', 'medium', 'weak', '强', '中', '弱')
       OR (v_binding->>'from_ref_type' = 'world' AND NOT (v_binding->>'from_ref_id' = ANY(v_world_keys)))
       OR (v_binding->>'to_ref_type' = 'world' AND NOT (v_binding->>'to_ref_id' = ANY(v_world_keys)))
       OR (v_binding->>'from_ref_type' = 'character' AND NOT (v_binding->>'from_ref_id' = ANY(v_char_refs)))
       OR (v_binding->>'to_ref_type' = 'character' AND NOT (v_binding->>'to_ref_id' = ANY(v_char_refs))) THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial world binding must resolve both endpoints inside the submitted book package.');
    END IF;
  END LOOP;

  FOR v_char IN SELECT value FROM jsonb_array_elements(p_request->'characters')
  LOOP
    v_ref := COALESCE(v_char->>'client_ref', v_char->>'char_code');
    IF v_char #> '{five_layers_json,L2,resources}' IS NOT NULL
       AND jsonb_typeof(v_char #> '{five_layers_json,L2,resources}') IS DISTINCT FROM 'array' THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Character L2 resources must be an array of traceable resource atom keys.');
    END IF;
    FOR v_resource_ref IN
      SELECT resource.value #>> '{}'
      FROM jsonb_array_elements(COALESCE(v_char #> '{five_layers_json,L2,resources}', '[]'::jsonb)) AS resource(value)
    LOOP
      IF COALESCE(btrim(v_resource_ref), '') = ''
         OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_request->'world_states') AS world(value)
           WHERE world.value->>'board_type' = 'resource'
             AND world.value->>'atom_type' = 'resource'
             AND world.value->>'atom_key' = v_resource_ref
         )
         OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(p_request->'world_bindings', '[]'::jsonb)) AS binding(value)
           WHERE binding.value->>'from_ref_type' = 'character'
             AND binding.value->>'from_ref_id' = v_ref
             AND binding.value->>'to_ref_type' = 'world'
             AND binding.value->>'to_ref_id' = v_resource_ref
         ) THEN
        RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every character L2 resource must resolve through a character-to-world binding in the submitted book package.');
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_typeof(v_l1a->'participant_char_refs') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_l1a->'participant_char_refs') = 0
     OR jsonb_array_length(v_l1a->'participant_char_refs') <> (
       SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_l1a->'participant_char_refs') AS refs(value)
     ) THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'The initial L1A must name at least one participating initial character.');
  END IF;
  FOR v_participant_ref IN SELECT jsonb_array_elements_text(v_l1a->'participant_char_refs')
  LOOP
    IF NOT (v_participant_ref = ANY(v_char_refs)) THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'The initial L1A references an unknown participant character.');
    END IF;
  END LOOP;
  IF COALESCE(v_l1a->>'l1a_index', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(v_l1a->>'l1a_name', '') = ''
     OR COALESCE(v_l1a->>'scene_location', '') = ''
     OR COALESCE(v_l1a->>'conflict_background', '') = ''
     OR COALESCE(v_l1a->>'escalation_path', '') = ''
     OR COALESCE(v_l1a->>'stakes', '') = ''
     OR COALESCE(v_l1a->>'irreversible_consequence', '') = ''
     OR jsonb_typeof(v_l1a->'plot_emotion_commit') IS DISTINCT FROM 'object'
     OR v_l1a->'plot_emotion_commit' = '{}'::jsonb
     OR jsonb_typeof(v_l1a->'arc_requirement') IS DISTINCT FROM 'object'
     OR v_l1a->'arc_requirement' = '{}'::jsonb
     OR jsonb_typeof(v_l1a->'info_reveal_boundary') IS DISTINCT FROM 'object'
     OR v_l1a->'info_reveal_boundary' = '{}'::jsonb
     OR jsonb_typeof(v_l1a->'role_arc_json') IS DISTINCT FROM 'object'
     OR v_l1a->'role_arc_json' = '{}'::jsonb THEN
    RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'The initial L1A commitment is incomplete.');
  END IF;

  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_create_book_project', v_key, v_operator, NULL, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.book_project
    WHERE local_operator_id = v_operator AND normalized_title = v_normalized_title
  ) THEN
    RETURN public.v7_error('DUPLICATE_TITLE', 'A book with this title already exists for this local operator.');
  END IF;
  PERFORM public.v7_enable_internal_write();
  INSERT INTO public.book_project(
    id, local_operator_id, title, normalized_title, genre_main, intent_json,
    forbid_json, selling_points_json, target_words, chapter_words, commercial_score
  ) VALUES (
    v_book, v_operator, v_title, v_normalized_title, v_genre,
    (p_request->'intent_json') || jsonb_build_object('genre_main', v_genre),
    p_request->'forbid_json', p_request->'selling_points_json',
    NULLIF(p_request->>'target_words', '')::integer,
    NULLIF(p_request->>'chapter_words', '')::integer,
    NULLIF(p_request->>'commercial_score', '')::integer
  );

  FOR v_char IN SELECT value FROM jsonb_array_elements(p_request->'characters')
  LOOP
    v_ref := COALESCE(v_char->>'client_ref', v_char->>'char_code');
    v_char_id := gen_random_uuid();
    INSERT INTO public.character(
      id, logical_character_id, book_id, char_name, five_layers_json,
      knowledge_boundary_json, arc_json, status, is_active, is_formal,
      is_shadow, is_valid, char_type, char_code, gender, cheat_hot_json,
      conflict_seed_json
    ) VALUES (
      v_char_id, v_char_id, v_book, v_char->>'char_name',
      v_char->'five_layers_json', v_char->'knowledge_boundary_json',
      v_char->'arc_json', 'active', COALESCE((v_char->>'is_active')::boolean, true),
      true, false, true, v_char->>'char_type', COALESCE(NULLIF(v_char->>'char_code', ''), v_ref),
      v_char->>'gender', v_char->'cheat_hot_json', v_char->'conflict_seed_json'
    );
    v_char_map := v_char_map || jsonb_build_object(v_ref, v_char_id::text);
    v_char_ids := v_char_ids || jsonb_build_array(v_char_id);
  END LOOP;

  FOR v_world IN SELECT value FROM jsonb_array_elements(p_request->'world_states')
  LOOP
    INSERT INTO public.world_state(
      book_id, board_type, atom_type, atom_key, atom_value_jsonb, affordance_dims,
      source_type, setting_layer, is_active, is_formal, is_shadow, is_valid,
      knowledge_boundary_json, apply_scope_json, violate_cost_json, chain_change_json,
      reverse_dep_index, reveal_order, l1a_change_log_json, gen_l1a_json,
      conflict_with_initial
    ) VALUES (
      v_book, v_world->>'board_type', v_world->>'atom_type', v_world->>'atom_key',
      v_world->'atom_value_jsonb', COALESCE(v_world->'affordance_dims', '[]'::jsonb),
      COALESCE(v_world->>'source_type', 'manual'), 'initial', true, true, false, true,
      v_world->'knowledge_boundary_json', v_world->'apply_scope_json',
      v_world->'violate_cost_json', v_world->'chain_change_json',
      v_world->'reverse_dep_index', NULLIF(v_world->>'reveal_order', '')::integer,
      v_world->'l1a_change_log_json', v_world->'gen_l1a_json',
      v_world->'conflict_with_initial'
    ) RETURNING id INTO v_char_id;
    v_world_ids := v_world_ids || jsonb_build_array(v_char_id);
  END LOOP;

  FOR v_binding IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'world_bindings', '[]'::jsonb))
  LOOP
    INSERT INTO public.world_binding(
      book_id, from_ref_type, from_ref_id, to_ref_type, to_ref_id, binding_type,
      binding_strength, setting_layer, is_formal, is_shadow, is_valid
    ) VALUES (
      v_book, v_binding->>'from_ref_type',
      CASE WHEN v_binding->>'from_ref_type' = 'character'
        THEN v_char_map->>(v_binding->>'from_ref_id') ELSE v_binding->>'from_ref_id' END,
      v_binding->>'to_ref_type',
      CASE WHEN v_binding->>'to_ref_type' = 'character'
        THEN v_char_map->>(v_binding->>'to_ref_id') ELSE v_binding->>'to_ref_id' END,
      v_binding->>'binding_type',
      COALESCE(v_binding->>'binding_strength', 'medium'), 'initial', true, false, true
    );
  END LOOP;

  FOR v_relation IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'relations', '[]'::jsonb))
  LOOP
    INSERT INTO public.relation_state(
      book_id, char_a_id, char_b_id, trust, intimacy, power_balance, dependence,
      hostility, common_goal, secret_known, emotional_bond, relation_type,
      relation_hierarchy, relation_origin, relation_overview, change_event_json,
      is_formal, is_shadow, is_valid, support_level
    ) VALUES (
      v_book, (v_char_map->>(v_relation->>'char_a_ref'))::uuid,
      (v_char_map->>(v_relation->>'char_b_ref'))::uuid,
      COALESCE(NULLIF(v_relation->>'trust', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'intimacy', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'power_balance', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'dependence', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'hostility', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'common_goal', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'secret_known', '')::integer, 0),
      COALESCE(NULLIF(v_relation->>'emotional_bond', '')::integer, 0),
      v_relation->>'relation_type', v_relation->>'relation_hierarchy',
      v_relation->>'relation_origin', v_relation->>'relation_overview',
      v_relation->'change_event_json', true, false, true,
      NULLIF(v_relation->>'support_level', '')::integer
    ) RETURNING id INTO v_char_id;
    v_relation_ids := v_relation_ids || jsonb_build_array(v_char_id);
  END LOOP;

  FOR v_memory IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'initial_memories', '[]'::jsonb))
  LOOP
    INSERT INTO public.character_memory(
      book_id, char_id, chapter_id, chapter_version_id, memory_type, memory_content,
      truth_status, is_valid, is_shadow, importance, decay_rate
    ) VALUES (
      v_book, (v_char_map->>(v_memory->>'char_ref'))::uuid, NULL, NULL,
      COALESCE(v_memory->>'memory_type', 'knowledge'), v_memory->>'memory_content',
      COALESCE(v_memory->>'truth_status', 'true'), true, false,
      COALESCE(NULLIF(v_memory->>'importance', '')::numeric, 0.50),
      COALESCE(NULLIF(v_memory->>'decay_rate', '')::numeric, 0.10)
    );
  END LOOP;

  FOR v_participant_ref IN SELECT jsonb_array_elements_text(COALESCE(v_l1a->'participant_char_refs', '[]'::jsonb))
  LOOP
    v_participants := v_participants || jsonb_build_array((v_char_map->>v_participant_ref)::uuid);
  END LOOP;

  INSERT INTO public.l1a_unit(
    id, book_id, l1a_index, l1a_name, scene_location, conflict_background, escalation_path,
    stakes, irreversible_consequence, plot_emotion_commit, arc_requirement,
    info_reveal_boundary, role_arc_json, status, source_type, confirmation_status,
    is_shadow, is_formal, is_valid, is_locked, core_conflict_flag, mid_goals,
    world_progress_json, narrative_techniques, future_value_reserved,
    future_setting_seeds, world_resistance_refs, jinzhan, payoff, emotion_type,
    has_explicit_hook, consequences, escalation, related_hook, role_arcs,
    participant_chars_json
  ) VALUES (
    v_l1a_id, v_book, COALESCE(NULLIF(v_l1a->>'l1a_index', '')::integer, 0),
    v_l1a->>'l1a_name', v_l1a->>'scene_location', v_l1a->>'conflict_background', v_l1a->>'escalation_path',
    v_l1a->>'stakes', v_l1a->>'irreversible_consequence',
    v_l1a->'plot_emotion_commit', v_l1a->'arc_requirement',
    v_l1a->'info_reveal_boundary', v_l1a->'role_arc_json', 'candidate', 'initial',
    'unconfirmed', false, false, true, false, true, v_l1a->'mid_goals',
    v_l1a->'world_progress_json', v_l1a->'narrative_techniques',
    v_l1a->'future_value_reserved', v_l1a->'future_setting_seeds',
    v_l1a->'world_resistance_refs', v_l1a->'jinzhan', v_l1a->'payoff',
    v_l1a->>'emotion_type', COALESCE((v_l1a->>'has_explicit_hook')::boolean, false),
    v_l1a->>'consequences', v_l1a->>'escalation', v_l1a->'related_hook',
    COALESCE(v_l1a->'role_arcs', '[]'::jsonb), v_participants
  );

  INSERT INTO public.writeback_log(
    book_id, chapter_id, chapter_version_id, transaction_id, writeback_scope_jsonb,
    status, source_version_no
  ) VALUES (
    v_book, NULL, NULL, gen_random_uuid(),
    jsonb_build_object('tables', jsonb_build_array('book_project', 'character', 'relation_state', 'world_state', 'l1a_unit')),
    'success', 'book-create'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object(
      'character_ids', v_char_ids,
      'world_ids', v_world_ids,
      'relation_ids', v_relation_ids,
      'initial_l1a_id', v_l1a_id
    ),
    'state', jsonb_build_object('stage_code', 'design', 'token_budget', 3000000)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_create_book_project', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_commit_world_settings(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_delete_ids uuid[] := ARRAY[]::uuid[];
  v_binding_ids uuid[] := ARRAY[]::uuid[];
  v_delete_binding_ids uuid[] := ARRAY[]::uuid[];
  v_count integer;
  v_world public.world_state%ROWTYPE;
  v_binding public.world_binding%ROWTYPE;
  v_formal_ids jsonb := '[]'::jsonb;
  v_formal_binding_ids jsonb := '[]'::jsonb;
  v_deleted_world_ids jsonb := '[]'::jsonb;
  v_deleted_binding_ids jsonb := '[]'::jsonb;
  v_invalidated_binding_ids jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  IF NOT (p_request ? 'world_candidate_ids')
     AND NOT (p_request ? 'delete_world_ids')
     AND NOT (p_request ? 'delete_world_binding_ids') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'At least one world candidate, world delete target, or binding delete target is required.');
  END IF;
  IF p_request ? 'world_candidate_ids' THEN
    IF jsonb_typeof(p_request->'world_candidate_ids') IS DISTINCT FROM 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'world_candidate_ids must be an array.');
    END IF;
    IF jsonb_array_length(p_request->'world_candidate_ids') = 0 THEN
      RETURN public.v7_error('INVALID_REQUEST', 'world_candidate_ids must contain at least one candidate when supplied.');
    END IF;
  END IF;
  IF p_request ? 'delete_world_ids' THEN
    IF jsonb_typeof(p_request->'delete_world_ids') IS DISTINCT FROM 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_ids must be an array.');
    END IF;
    IF jsonb_array_length(p_request->'delete_world_ids') = 0 THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_ids must contain at least one target when supplied.');
    END IF;
  END IF;
  IF p_request ? 'delete_world_binding_ids' THEN
    IF jsonb_typeof(p_request->'delete_world_binding_ids') IS DISTINCT FROM 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_binding_ids must be an array.');
    END IF;
    IF jsonb_array_length(p_request->'delete_world_binding_ids') = 0 THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_binding_ids must contain at least one target when supplied.');
    END IF;
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_commit_world_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('DESIGN_LOCKED', 'World settings are read-only after L1A sorting is confirmed.');
  END IF;

  IF p_request ? 'world_candidate_ids' THEN
    BEGIN
      SELECT array_agg(value::uuid) INTO v_ids
      FROM jsonb_array_elements_text(p_request->'world_candidate_ids') AS candidate(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'world_candidate_ids must contain UUIDs.');
    END;
    IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'world_candidate_ids must not contain duplicates.');
    END IF;
    SELECT count(*) INTO v_count
    FROM public.world_state
    WHERE id = ANY(v_ids)
      AND book_id = v_book
      AND NOT is_formal
      AND is_valid
      AND NOT is_shadow;
    IF v_count <> cardinality(v_ids) THEN
      RETURN public.v7_error('CANDIDATE_REJECTED', 'Every world candidate must be active, unshadowed, and belong to this book.');
    END IF;
  END IF;

  IF p_request ? 'delete_world_ids' THEN
    BEGIN
      SELECT array_agg(value::uuid) INTO v_delete_ids
      FROM jsonb_array_elements_text(p_request->'delete_world_ids') AS target(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_ids must contain UUIDs.');
    END;
    IF cardinality(v_delete_ids) <> (SELECT count(DISTINCT value) FROM unnest(v_delete_ids) AS target(value)) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_ids must not contain duplicates.');
    END IF;
    SELECT count(*) INTO v_count
    FROM public.world_state
    WHERE id = ANY(v_delete_ids)
      AND book_id = v_book
      AND setting_layer = 'initial'
      AND is_active
      AND is_formal
      AND is_valid
      AND NOT is_shadow;
    IF v_count <> cardinality(v_delete_ids) THEN
      RETURN public.v7_error('DELETE_TARGET_REJECTED', 'Every delete target must be an active initial world setting in this book.');
    END IF;
  END IF;

  IF p_request ? 'delete_world_binding_ids' THEN
    BEGIN
      SELECT array_agg(value::uuid) INTO v_delete_binding_ids
      FROM jsonb_array_elements_text(p_request->'delete_world_binding_ids') AS target(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_binding_ids must contain UUIDs.');
    END;
    IF cardinality(v_delete_binding_ids) <> (
      SELECT count(DISTINCT value) FROM unnest(v_delete_binding_ids) AS target(value)
    ) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'delete_world_binding_ids must not contain duplicates.');
    END IF;
    SELECT count(*) INTO v_count
    FROM public.world_binding
    WHERE id = ANY(v_delete_binding_ids)
      AND book_id = v_book
      AND setting_layer = 'initial'
      AND is_formal
      AND is_valid
      AND NOT is_shadow;
    IF v_count <> cardinality(v_delete_binding_ids) THEN
      RETURN public.v7_error('DELETE_BINDING_TARGET_REJECTED', 'Every binding delete target must be an active initial formal binding in this book.');
    END IF;
  END IF;

  IF p_request ? 'binding_candidate_ids' THEN
    IF jsonb_typeof(p_request->'binding_candidate_ids') <> 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must be an array.');
    END IF;
    BEGIN
      SELECT array_agg(value::uuid) INTO v_binding_ids
      FROM jsonb_array_elements_text(p_request->'binding_candidate_ids') AS candidate(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must contain UUIDs.');
    END;
    IF COALESCE(cardinality(v_binding_ids), 0) <> (
      SELECT count(DISTINCT value) FROM unnest(COALESCE(v_binding_ids, ARRAY[]::uuid[])) AS candidate(value)
    ) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must not contain duplicates.');
    END IF;
    IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
      SELECT count(*) INTO v_count
      FROM public.world_binding
      WHERE id = ANY(v_binding_ids)
        AND book_id = v_book
        AND NOT is_formal
        AND is_valid
        AND NOT is_shadow;
      IF v_count <> cardinality(v_binding_ids) THEN
        RETURN public.v7_error('CANDIDATE_REJECTED', 'Every world binding candidate must belong to this book.');
      END IF;
    END IF;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_commit_world_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('DESIGN_LOCKED', 'World settings are read-only after L1A sorting is confirmed.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.world_state
  WHERE id = ANY(v_ids)
    AND book_id = v_book
    AND NOT is_formal
    AND is_valid
    AND NOT is_shadow;
  IF v_count <> cardinality(v_ids) THEN
    RETURN public.v7_error('CANDIDATE_REJECTED', 'Every world candidate must be active, unshadowed, and belong to this book.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.world_state
  WHERE id = ANY(v_delete_ids)
    AND book_id = v_book
    AND setting_layer = 'initial'
    AND is_active
    AND is_formal
    AND is_valid
    AND NOT is_shadow;
  IF v_count <> cardinality(v_delete_ids) THEN
    RETURN public.v7_error('DELETE_TARGET_REJECTED', 'Every delete target must be an active initial world setting in this book.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.world_binding
  WHERE id = ANY(v_delete_binding_ids)
    AND book_id = v_book
    AND setting_layer = 'initial'
    AND is_formal
    AND is_valid
    AND NOT is_shadow;
  IF v_count <> cardinality(v_delete_binding_ids) THEN
    RETURN public.v7_error('DELETE_BINDING_TARGET_REJECTED', 'Every binding delete target must be an active initial formal binding in this book.');
  END IF;
  IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
    SELECT count(*) INTO v_count
    FROM public.world_binding
    WHERE id = ANY(v_binding_ids)
      AND book_id = v_book
      AND NOT is_formal
      AND is_valid
      AND NOT is_shadow;
    IF v_count <> cardinality(v_binding_ids) THEN
      RETURN public.v7_error('CANDIDATE_REJECTED', 'Every world binding candidate must belong to this book.');
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.world_state AS candidate
    JOIN public.world_state AS target
      ON target.id = ANY(v_delete_ids)
     AND target.book_id = candidate.book_id
     AND target.setting_layer = candidate.setting_layer
     AND target.atom_key = candidate.atom_key
     AND target.origin_l1a_id IS NOT DISTINCT FROM candidate.origin_l1a_id
    WHERE candidate.id = ANY(v_ids)
  ) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The same world setting cannot be confirmed and deleted in one request.');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.world_binding AS candidate
    JOIN public.world_state AS target
      ON target.id = ANY(v_delete_ids)
     AND target.book_id = candidate.book_id
     AND target.setting_layer = candidate.setting_layer
     AND target.origin_l1a_id IS NOT DISTINCT FROM candidate.origin_l1a_id
     AND (
       (candidate.from_ref_type = 'world' AND candidate.from_ref_id = target.atom_key)
       OR (candidate.to_ref_type = 'world' AND candidate.to_ref_id = target.atom_key)
     )
    WHERE candidate.id = ANY(COALESCE(v_binding_ids, ARRAY[]::uuid[]))
  ) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A binding connected to a deleted world setting cannot be confirmed in the same request.');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.world_binding AS candidate
    JOIN public.world_binding AS target
      ON target.id = ANY(v_delete_binding_ids)
     AND target.book_id = candidate.book_id
     AND target.from_ref_type = candidate.from_ref_type
     AND target.from_ref_id = candidate.from_ref_id
     AND target.to_ref_type = candidate.to_ref_type
     AND target.to_ref_id = candidate.to_ref_id
     AND target.binding_type = candidate.binding_type
     AND target.setting_layer = candidate.setting_layer
     AND target.origin_l1a_id IS NOT DISTINCT FROM candidate.origin_l1a_id
    WHERE candidate.id = ANY(COALESCE(v_binding_ids, ARRAY[]::uuid[]))
  ) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The same world binding cannot be confirmed and deleted in one request.');
  END IF;
  PERFORM public.v7_enable_internal_write();
  FOR v_world IN
    SELECT * FROM public.world_state WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE
  LOOP
    UPDATE public.world_state
    SET is_formal = false,
        is_shadow = true,
        is_valid = false,
        is_active = false
    WHERE book_id = v_book
      AND setting_layer = v_world.setting_layer
      AND atom_key = v_world.atom_key
      AND is_formal
      AND is_valid
      AND NOT is_shadow
      AND id <> v_world.id;

    UPDATE public.world_state
    SET is_formal = true,
        is_shadow = false,
        is_valid = true,
        is_active = (setting_layer = 'initial')
    WHERE id = v_world.id;
    v_formal_ids := v_formal_ids || jsonb_build_array(v_world.id);
  END LOOP;

  IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
    FOR v_binding IN
      SELECT * FROM public.world_binding WHERE id = ANY(v_binding_ids) ORDER BY id FOR UPDATE
    LOOP
      UPDATE public.world_binding
      SET is_formal = false,
          is_shadow = true,
          is_valid = false
      WHERE book_id = v_book
        AND from_ref_type = v_binding.from_ref_type
        AND from_ref_id = v_binding.from_ref_id
        AND to_ref_type = v_binding.to_ref_type
        AND to_ref_id = v_binding.to_ref_id
        AND binding_type = v_binding.binding_type
        AND setting_layer = v_binding.setting_layer
        AND is_formal
        AND is_valid
        AND NOT is_shadow
        AND id <> v_binding.id;

      UPDATE public.world_binding
      SET is_formal = true,
          is_shadow = false,
          is_valid = true
      WHERE id = v_binding.id;
      v_formal_binding_ids := v_formal_binding_ids || jsonb_build_array(v_binding.id);
    END LOOP;
  END IF;

  IF cardinality(v_delete_binding_ids) > 0 THEN
    WITH deleted AS (
      UPDATE public.world_binding
      SET is_formal = false,
          is_shadow = true,
          is_valid = false
      WHERE id = ANY(v_delete_binding_ids)
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_deleted_binding_ids
    FROM deleted;
  END IF;

  IF cardinality(v_delete_ids) > 0 THEN
    WITH invalidated AS (
      UPDATE public.world_binding AS binding
      SET is_formal = false,
          is_shadow = true,
          is_valid = false
      WHERE binding.book_id = v_book
        AND binding.is_valid
        AND NOT binding.is_shadow
        AND NOT (binding.id = ANY(v_delete_binding_ids))
        AND EXISTS (
          SELECT 1
          FROM public.world_state AS target
          WHERE target.id = ANY(v_delete_ids)
            AND target.book_id = binding.book_id
            AND target.setting_layer = binding.setting_layer
            AND target.origin_l1a_id IS NOT DISTINCT FROM binding.origin_l1a_id
            AND (
              (binding.from_ref_type = 'world' AND binding.from_ref_id = target.atom_key)
              OR (binding.to_ref_type = 'world' AND binding.to_ref_id = target.atom_key)
            )
        )
      RETURNING binding.id
    )
    SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_invalidated_binding_ids
    FROM invalidated;

    WITH deleted AS (
      UPDATE public.world_state
      SET is_active = false,
          is_formal = false,
          is_shadow = true,
          is_valid = false
      WHERE id = ANY(v_delete_ids)
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_deleted_world_ids
    FROM deleted;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object(
      'world_ids', v_formal_ids,
      'world_binding_ids', v_formal_binding_ids,
      'deleted_world_ids', v_deleted_world_ids,
      'deleted_world_binding_ids', v_deleted_binding_ids,
      'invalidated_world_binding_ids', v_invalidated_binding_ids
    ),
    'state', jsonb_build_object('design_editable', true)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_commit_world_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_commit_character_settings(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_character_ids uuid[];
  v_relation_ids uuid[];
  v_binding_ids uuid[];
  v_count integer;
  v_character public.character%ROWTYPE;
  v_relation public.relation_state%ROWTYPE;
  v_binding public.world_binding%ROWTYPE;
  v_memory jsonb;
  v_formal_character_ids jsonb := '[]'::jsonb;
  v_formal_relation_ids jsonb := '[]'::jsonb;
  v_formal_binding_ids jsonb := '[]'::jsonb;
  v_a_logical uuid;
  v_b_logical uuid;
  v_relation_pair text;
  v_relation_pairs text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  IF jsonb_typeof(p_request->'character_candidate_ids') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'character_candidate_ids') = 0 THEN
    RETURN public.v7_error('INVALID_REQUEST', 'character_candidate_ids must contain at least one candidate.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_commit_character_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('DESIGN_LOCKED', 'Character settings are read-only after L1A sorting is confirmed.');
  END IF;

  BEGIN
    SELECT array_agg(value::uuid) INTO v_character_ids
    FROM jsonb_array_elements_text(p_request->'character_candidate_ids') AS candidate(value);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'character_candidate_ids must contain UUIDs.');
  END;
  IF cardinality(v_character_ids) <> (SELECT count(DISTINCT value) FROM unnest(v_character_ids) AS candidate(value)) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'character_candidate_ids must not contain duplicates.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.character
  WHERE id = ANY(v_character_ids)
    AND book_id = v_book
    AND status = 'candidate'
    AND NOT is_formal
    AND is_valid
    AND NOT is_shadow;
  IF v_count <> cardinality(v_character_ids) THEN
    RETURN public.v7_error('CANDIDATE_REJECTED', 'Every character candidate must be active, complete, and scoped to this book.');
  END IF;

  IF p_request ? 'relation_candidate_ids' THEN
    IF jsonb_typeof(p_request->'relation_candidate_ids') <> 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'relation_candidate_ids must be an array.');
    END IF;
    BEGIN
      SELECT array_agg(value::uuid) INTO v_relation_ids
      FROM jsonb_array_elements_text(p_request->'relation_candidate_ids') AS candidate(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'relation_candidate_ids must contain UUIDs.');
    END;
    IF COALESCE(cardinality(v_relation_ids), 0) <> (
      SELECT count(DISTINCT value) FROM unnest(COALESCE(v_relation_ids, ARRAY[]::uuid[])) AS candidate(value)
    ) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'relation_candidate_ids must not contain duplicates.');
    END IF;
    IF COALESCE(cardinality(v_relation_ids), 0) > 0 THEN
      SELECT count(*) INTO v_count
      FROM public.relation_state AS r
      JOIN public.character AS a
        ON a.id = r.char_a_id
       AND a.book_id = r.book_id
      JOIN public.character AS b
        ON b.id = r.char_b_id
       AND b.book_id = r.book_id
      JOIN public.book_project AS bp
        ON bp.id = r.book_id
       AND bp.local_operator_id = v_operator
      WHERE r.id = ANY(v_relation_ids)
        AND r.book_id = v_book
        AND r.char_a_id = ANY(v_character_ids)
        AND r.char_b_id = ANY(v_character_ids)
        AND NOT r.is_formal
        AND r.is_valid
        AND NOT r.is_shadow;
      IF v_count <> cardinality(v_relation_ids) THEN
        RETURN public.v7_error('CANDIDATE_REJECTED', 'Every relation candidate and both of its characters must belong to this book.');
      END IF;
    END IF;
  END IF;

  IF p_request ? 'binding_candidate_ids' THEN
    IF jsonb_typeof(p_request->'binding_candidate_ids') <> 'array' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must be an array.');
    END IF;
    BEGIN
      SELECT array_agg(value::uuid) INTO v_binding_ids
      FROM jsonb_array_elements_text(p_request->'binding_candidate_ids') AS candidate(value);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must contain UUIDs.');
    END;
    IF COALESCE(cardinality(v_binding_ids), 0) <> (
      SELECT count(DISTINCT value) FROM unnest(COALESCE(v_binding_ids, ARRAY[]::uuid[])) AS candidate(value)
    ) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'binding_candidate_ids must not contain duplicates.');
    END IF;
    IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
      SELECT count(*) INTO v_count
      FROM public.world_binding
      WHERE id = ANY(v_binding_ids)
        AND book_id = v_book
        AND NOT is_formal
        AND is_valid
        AND NOT is_shadow;
      IF v_count <> cardinality(v_binding_ids) THEN
        RETURN public.v7_error('CANDIDATE_REJECTED', 'Every character binding candidate must belong to this book.');
      END IF;
    END IF;
  END IF;

  IF jsonb_typeof(COALESCE(p_request->'initial_memories', '[]'::jsonb)) <> 'array' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'initial_memories must be an array.');
  END IF;
  FOR v_memory IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'initial_memories', '[]'::jsonb))
  LOOP
    IF COALESCE(v_memory->>'char_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NOT EXISTS (
      SELECT 1 FROM public.character
      WHERE id::text = lower(v_memory->>'char_id')
        AND book_id = v_book
        AND id = ANY(v_character_ids)
    )
       OR COALESCE(v_memory->>'memory_type', '') NOT IN ('event', 'emotion', 'knowledge', 'relationship')
       OR COALESCE(v_memory->>'truth_status', '') NOT IN ('true', 'misremembered', 'false')
       OR COALESCE(v_memory->>'memory_content', '') = ''
       OR (v_memory ? 'importance' AND COALESCE(v_memory->>'importance', '') !~ '^(0(\.[0-9]+)?|1(\.0+)?)$')
       OR (v_memory ? 'decay_rate' AND COALESCE(v_memory->>'decay_rate', '') !~ '^(0(\.[0-9]+)?|1(\.0+)?)$') THEN
      RETURN public.v7_error('INITIAL_DATA_INCOMPLETE', 'Every initial memory must target a submitted character and contain content.');
    END IF;
  END LOOP;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_commit_character_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('DESIGN_LOCKED', 'Character settings are read-only after L1A sorting is confirmed.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.character
  WHERE id = ANY(v_character_ids)
    AND book_id = v_book
    AND status = 'candidate'
    AND NOT is_formal
    AND is_valid
    AND NOT is_shadow;
  IF v_count <> cardinality(v_character_ids) THEN
    RETURN public.v7_error('CANDIDATE_REJECTED', 'Every character candidate must be active, complete, and scoped to this book.');
  END IF;
  IF COALESCE(cardinality(v_relation_ids), 0) > 0 THEN
    SELECT count(*) INTO v_count
    FROM public.relation_state AS r
    JOIN public.character AS a
      ON a.id = r.char_a_id
     AND a.book_id = r.book_id
    JOIN public.character AS b
      ON b.id = r.char_b_id
     AND b.book_id = r.book_id
    JOIN public.book_project AS bp
      ON bp.id = r.book_id
     AND bp.local_operator_id = v_operator
      WHERE r.id = ANY(v_relation_ids)
      AND r.book_id = v_book
      AND r.char_a_id = ANY(v_character_ids)
      AND r.char_b_id = ANY(v_character_ids)
      AND NOT r.is_formal
      AND r.is_valid
      AND NOT r.is_shadow;
    IF v_count <> cardinality(v_relation_ids) THEN
      RETURN public.v7_error('CANDIDATE_REJECTED', 'Every relation candidate and both of its characters must belong to this book.');
    END IF;
  END IF;
  IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
    SELECT count(*) INTO v_count
    FROM public.world_binding
    WHERE id = ANY(v_binding_ids)
      AND book_id = v_book
      AND NOT is_formal
      AND is_valid
      AND NOT is_shadow;
    IF v_count <> cardinality(v_binding_ids) THEN
      RETURN public.v7_error('CANDIDATE_REJECTED', 'Every character binding candidate must belong to this book.');
    END IF;
  END IF;
  FOR v_character IN
    SELECT * FROM public.character WHERE id = ANY(v_character_ids) ORDER BY id FOR UPDATE
  LOOP
    IF COALESCE(v_character.char_type, '') NOT IN ('protagonist', 'supporting', 'ensemble', 'antagonist')
       OR jsonb_typeof(v_character.five_layers_json) <> 'object'
       OR NOT (v_character.five_layers_json ?& ARRAY['L0', 'L1', 'L2', 'L3'])
       OR EXISTS (
         SELECT 1 FROM unnest(ARRAY['L0', 'L1', 'L2', 'L3']) AS layer(name)
         WHERE jsonb_typeof(v_character.five_layers_json->layer.name) <> 'object'
            OR v_character.five_layers_json->layer.name = '{}'::jsonb
       )
       OR jsonb_typeof(v_character.knowledge_boundary_json) <> 'object'
       OR NOT (v_character.knowledge_boundary_json ?& ARRAY['knows', 'unknown', 'false_belief', 'reasonable_suspect'])
       OR EXISTS (
         SELECT 1 FROM unnest(ARRAY['knows', 'unknown', 'false_belief', 'reasonable_suspect']) AS quadrant(name)
         WHERE jsonb_typeof(v_character.knowledge_boundary_json->quadrant.name) <> 'array'
       )
       OR jsonb_typeof(v_character.arc_json) <> 'object'
       OR v_character.arc_json = '{}'::jsonb THEN
      RETURN public.v7_error('CANDIDATE_REJECTED', 'Every character candidate must retain complete L0-L3, knowledge quadrants, role type, and arc data.');
    END IF;
  END LOOP;
  IF COALESCE(cardinality(v_relation_ids), 0) > 0 THEN
    FOR v_relation IN
      SELECT * FROM public.relation_state WHERE id = ANY(v_relation_ids) ORDER BY id FOR UPDATE
    LOOP
      SELECT logical_character_id INTO v_a_logical FROM public.character WHERE id = v_relation.char_a_id;
      SELECT logical_character_id INTO v_b_logical FROM public.character WHERE id = v_relation.char_b_id;
      v_relation_pair := CASE
        WHEN v_a_logical < v_b_logical THEN v_a_logical::text || ':' || v_b_logical::text
        ELSE v_b_logical::text || ':' || v_a_logical::text
      END;
      IF v_relation_pair = ANY(v_relation_pairs)
         OR jsonb_typeof(v_relation.change_event_json) <> 'object'
         OR v_relation.change_event_json = '{}'::jsonb THEN
        RETURN public.v7_error('CANDIDATE_REJECTED', 'Relation candidates must contain one complete event for each unique undirected character pair.');
      END IF;
      v_relation_pairs := array_append(v_relation_pairs, v_relation_pair);
    END LOOP;
  END IF;
  PERFORM public.v7_enable_internal_write();
  FOR v_character IN
    SELECT * FROM public.character WHERE id = ANY(v_character_ids) ORDER BY id FOR UPDATE
  LOOP
    UPDATE public.character
    SET is_formal = false,
        is_shadow = true,
        is_valid = false,
        is_active = false
    WHERE book_id = v_book
      AND logical_character_id = v_character.logical_character_id
      AND is_formal
      AND is_valid
      AND NOT is_shadow
      AND id <> v_character.id;

    UPDATE public.character
    SET status = 'active',
        is_formal = true,
        is_shadow = false,
        is_valid = true,
        is_active = true
    WHERE id = v_character.id;
    v_formal_character_ids := v_formal_character_ids || jsonb_build_array(v_character.id);
  END LOOP;

  IF COALESCE(cardinality(v_relation_ids), 0) > 0 THEN
    FOR v_relation IN
      SELECT * FROM public.relation_state WHERE id = ANY(v_relation_ids) ORDER BY id FOR UPDATE
    LOOP
      SELECT logical_character_id INTO v_a_logical FROM public.character WHERE id = v_relation.char_a_id;
      SELECT logical_character_id INTO v_b_logical FROM public.character WHERE id = v_relation.char_b_id;
      UPDATE public.relation_state AS old_relation
      SET is_formal = false,
          is_shadow = true,
          is_valid = false
      FROM public.character AS old_a, public.character AS old_b
      WHERE old_relation.book_id = v_book
        AND old_relation.char_a_id = old_a.id
        AND old_relation.char_b_id = old_b.id
        AND old_a.logical_character_id = v_a_logical
        AND old_b.logical_character_id = v_b_logical
        AND old_relation.is_formal
        AND old_relation.is_valid
        AND NOT old_relation.is_shadow
        AND old_relation.id <> v_relation.id;

      UPDATE public.relation_state
      SET is_formal = true,
          is_shadow = false,
          is_valid = true
      WHERE id = v_relation.id;
      v_formal_relation_ids := v_formal_relation_ids || jsonb_build_array(v_relation.id);
    END LOOP;
  END IF;

  IF COALESCE(cardinality(v_binding_ids), 0) > 0 THEN
    FOR v_binding IN
      SELECT * FROM public.world_binding WHERE id = ANY(v_binding_ids) ORDER BY id FOR UPDATE
    LOOP
      UPDATE public.world_binding
      SET is_formal = false,
          is_shadow = true,
          is_valid = false
      WHERE book_id = v_book
        AND from_ref_type = v_binding.from_ref_type
        AND from_ref_id = v_binding.from_ref_id
        AND to_ref_type = v_binding.to_ref_type
        AND to_ref_id = v_binding.to_ref_id
        AND binding_type = v_binding.binding_type
        AND setting_layer = v_binding.setting_layer
        AND is_formal
        AND is_valid
        AND NOT is_shadow
        AND id <> v_binding.id;
      UPDATE public.world_binding
      SET is_formal = true,
          is_shadow = false,
          is_valid = true
      WHERE id = v_binding.id;
      v_formal_binding_ids := v_formal_binding_ids || jsonb_build_array(v_binding.id);
    END LOOP;
  END IF;

  FOR v_memory IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'initial_memories', '[]'::jsonb))
  LOOP
    INSERT INTO public.character_memory(
      book_id, char_id, chapter_id, chapter_version_id, memory_type, memory_content,
      truth_status, is_valid, is_shadow, importance, decay_rate
    ) VALUES (
      v_book, (v_memory->>'char_id')::uuid, NULL, NULL,
      COALESCE(v_memory->>'memory_type', 'knowledge'), v_memory->>'memory_content',
      COALESCE(v_memory->>'truth_status', 'true'), true, false,
      COALESCE(NULLIF(v_memory->>'importance', '')::numeric, 0.50),
      COALESCE(NULLIF(v_memory->>'decay_rate', '')::numeric, 0.10)
    );
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object(
      'character_ids', v_formal_character_ids,
      'relation_ids', v_formal_relation_ids,
      'world_binding_ids', v_formal_binding_ids
    ),
    'state', jsonb_build_object('design_editable', true)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_commit_character_settings', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_generate_l1a_conflicts(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_candidate jsonb;
  v_ref jsonb;
  v_participant text;
  v_next_index integer;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_design_fingerprint text;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  IF jsonb_typeof(p_request->'candidates') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'candidates') = 0 THEN
    RETURN public.v7_error('INVALID_REQUEST', 'At least one traversal candidate is required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_generate_l1a_conflicts', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_generate_l1a_conflicts', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.l1a_unit
    WHERE book_id = v_book AND is_locked AND is_valid AND NOT is_shadow
  ) THEN
    RETURN public.v7_error('L1A_LOCKED', 'L1A candidates cannot be generated after sorting is confirmed.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.l1a_unit
    WHERE book_id = v_book
      AND source_type = 'initial'
      AND is_valid
      AND NOT is_shadow
  ) OR NOT EXISTS (
    SELECT 1 FROM public.character
    WHERE book_id = v_book AND is_formal AND is_valid AND NOT is_shadow
  ) OR NOT EXISTS (
    SELECT 1 FROM public.world_state
    WHERE book_id = v_book AND is_formal AND is_valid AND NOT is_shadow
  ) THEN
    RETURN public.v7_error('UPSTREAM_INCOMPLETE', 'Initial L1A, formal characters, and formal world settings are required before traversal.');
  END IF;

  -- Validate all references before inserting any generated candidate.
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_request->'candidates')
  LOOP
    IF COALESCE(v_candidate->>'l1a_name', '') = ''
       OR COALESCE(v_candidate->>'scene_location', '') = ''
       OR COALESCE(v_candidate->>'conflict_background', '') = ''
       OR COALESCE(v_candidate->>'escalation_path', '') = ''
       OR COALESCE(v_candidate->>'stakes', '') = ''
       OR COALESCE(v_candidate->>'irreversible_consequence', '') = ''
       OR jsonb_typeof(v_candidate->'plot_emotion_commit') IS DISTINCT FROM 'object'
       OR v_candidate->'plot_emotion_commit' = '{}'::jsonb
       OR jsonb_typeof(v_candidate->'arc_requirement') IS DISTINCT FROM 'object'
       OR v_candidate->'arc_requirement' = '{}'::jsonb
       OR jsonb_typeof(v_candidate->'info_reveal_boundary') IS DISTINCT FROM 'object'
       OR v_candidate->'info_reveal_boundary' = '{}'::jsonb
       OR jsonb_typeof(v_candidate->'role_arc_json') IS DISTINCT FROM 'object'
       OR v_candidate->'role_arc_json' = '{}'::jsonb
       OR jsonb_typeof(COALESCE(v_candidate->'participant_chars_json', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(v_candidate->'participant_chars_json', '[]'::jsonb)) = 0
       OR jsonb_typeof(v_candidate->'world_resistance_refs') IS DISTINCT FROM 'array' THEN
      RETURN public.v7_error('CANDIDATE_INCOMPLETE', 'Every traversal candidate needs its commitment fields and world resistance references.');
    END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(v_candidate->'world_resistance_refs')
    LOOP
      IF COALESCE(v_ref->>'atom_key', '') = '' OR NOT EXISTS (
        SELECT 1 FROM public.world_state
        WHERE book_id = v_book
          AND atom_key = v_ref->>'atom_key'
          AND is_formal AND is_valid AND NOT is_shadow
      ) THEN
        RETURN public.v7_error('WORLD_REFERENCE_REJECTED', 'A traversal candidate references a world resistance that is not formal for this book.');
      END IF;
    END LOOP;
    FOR v_participant IN SELECT jsonb_array_elements_text(COALESCE(v_candidate->'participant_chars_json', '[]'::jsonb))
    LOOP
      IF COALESCE(v_participant, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR NOT EXISTS (
        SELECT 1 FROM public.character
        WHERE id::text = lower(v_participant)
          AND book_id = v_book
          AND is_formal AND is_valid AND NOT is_shadow
      ) THEN
        RETURN public.v7_error('CHARACTER_REFERENCE_REJECTED', 'A traversal candidate references a character outside the formal book scope.');
      END IF;
    END LOOP;
  END LOOP;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('L1A_LOCKED', 'L1A candidates cannot be generated after sorting is confirmed.');
  END IF;
  SELECT COALESCE(max(l1a_index), -1) + 1 INTO v_next_index
  FROM public.l1a_unit
  WHERE book_id = v_book AND is_valid AND NOT is_shadow;
  v_design_fingerprint := public.v7_formal_design_fingerprint(v_book);
  PERFORM public.v7_enable_internal_write();

  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_request->'candidates')
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.l1a_unit(
      id, book_id, l1a_index, l1a_name, scene_location, conflict_background, escalation_path,
      stakes, irreversible_consequence, plot_emotion_commit, arc_requirement,
      info_reveal_boundary, role_arc_json, status, source_type, confirmation_status,
      is_shadow, is_formal, is_valid, is_locked, is_patch, need_regen,
      mid_goals, world_progress_json, narrative_techniques, future_value_reserved,
      future_setting_seeds, world_resistance_refs, jinzhan, payoff, emotion_type,
      has_explicit_hook, consequences, escalation, related_hook, role_arcs,
      participant_chars_json, three_line_json
    ) VALUES (
      v_id, v_book, v_next_index,
      v_candidate->>'l1a_name', v_candidate->>'scene_location', v_candidate->>'conflict_background',
      v_candidate->>'escalation_path', v_candidate->>'stakes',
      v_candidate->>'irreversible_consequence', v_candidate->'plot_emotion_commit',
      v_candidate->'arc_requirement', v_candidate->'info_reveal_boundary',
      v_candidate->'role_arc_json', 'candidate', 'traversal', 'unconfirmed',
      false, false, true, false, COALESCE((v_candidate->>'is_patch')::boolean, false),
      false, v_candidate->'mid_goals', v_candidate->'world_progress_json',
      v_candidate->'narrative_techniques', v_candidate->'future_value_reserved',
      v_candidate->'future_setting_seeds', v_candidate->'world_resistance_refs',
      v_candidate->'jinzhan', v_candidate->'payoff', v_candidate->>'emotion_type',
      COALESCE((v_candidate->>'has_explicit_hook')::boolean, false),
      v_candidate->>'consequences', v_candidate->>'escalation',
      v_candidate->'related_hook', COALESCE(v_candidate->'role_arcs', '[]'::jsonb),
      COALESCE(v_candidate->'participant_chars_json', '[]'::jsonb),
      v_candidate->'three_line_json'
    );
    v_ids := v_ids || jsonb_build_array(v_id);
    v_next_index := v_next_index + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('l1a_candidate_ids', v_ids),
    'state', jsonb_build_object(
      'status', 'candidate',
      'design_fingerprint', v_design_fingerprint
    )
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_generate_l1a_conflicts', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_l1a(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_key text := p_request->>'idempotency_key';
  v_design_fingerprint text := p_request->>'design_fingerprint';
  v_current_fingerprint text;
  v_result jsonb;
  v_ids uuid[];
  v_count integer;
  v_offset integer;
  v_l1a public.l1a_unit%ROWTYPE;
  v_seed jsonb;
  v_atom jsonb;
  v_binding jsonb;
  v_participant_ref jsonb;
  v_resistance_ref jsonb;
  v_future_world_ids jsonb := '[]'::jsonb;
  v_future_binding_ids jsonb := '[]'::jsonb;
  v_future_id uuid;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  IF p_request ? 'l1a_ids'
     OR p_request ? 'current_l1a_id'
     OR jsonb_typeof(p_request->'ordered_l1a_ids') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'ordered_l1a_ids') = 0
     OR COALESCE(v_design_fingerprint, '') !~ '^[0-9a-f]{64}$' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'ordered_l1a_ids and the generation design_fingerprint are required; legacy L1A selection fields are not accepted.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_finalize_l1a', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  BEGIN
    SELECT array_agg(value::uuid ORDER BY ordinal_position) INTO v_ids
    FROM jsonb_array_elements_text(p_request->'ordered_l1a_ids') WITH ORDINALITY AS item(value, ordinal_position);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'ordered_l1a_ids must contain UUIDs.');
  END;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'ordered_l1a_ids must not contain duplicates.');
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_finalize_l1a', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT public.v7_design_editable(v_book) THEN
    RETURN public.v7_error('L1A_LOCKED', 'The L1A plan has already been confirmed and cannot be replaced.');
  END IF;
  v_current_fingerprint := public.v7_formal_design_fingerprint(v_book);
  IF v_design_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
    RETURN public.v7_error('DESIGN_STATE_CHANGED', 'The formal world, character, or relation design changed after L1A generation; regenerate before locking the sort.');
  END IF;
  SELECT count(*) INTO v_count
  FROM public.l1a_unit
  WHERE id = ANY(v_ids)
    AND book_id = v_book
    AND status IN ('candidate', 'sorted')
    AND NOT is_formal
    AND is_valid
    AND NOT is_shadow
    AND NOT is_locked;
  IF v_count <> cardinality(v_ids) THEN
    RETURN public.v7_error('L1A_REJECTED', 'Every confirmed L1A must be an unlocked candidate of this book.');
  END IF;
  IF v_count <> (
    SELECT count(*) FROM public.l1a_unit
    WHERE book_id = v_book AND NOT is_formal AND is_valid AND NOT is_shadow
  ) THEN
    RETURN public.v7_error('L1A_PLAN_INCOMPLETE', 'The confirmed sort must include every active L1A candidate.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.chapter_header
    WHERE l1a_unit_id = ANY(v_ids) AND is_finalized
  ) THEN
    RETURN public.v7_error('L1A_HAS_FINAL_CHAPTER', 'A finalized chapter prevents replacing this L1A plan.');
  END IF;

  -- Validate the stable candidate rows while the book is locked. This includes
  -- manual L1A references, which must consume only this book's live formal data.
  FOR v_l1a IN
    SELECT * FROM public.l1a_unit
    WHERE id = ANY(v_ids)
    ORDER BY l1a_index
    FOR UPDATE
  LOOP
    FOR v_seed IN SELECT value FROM jsonb_array_elements(COALESCE(v_l1a.future_setting_seeds, '[]'::jsonb))
    LOOP
      IF v_seed->>'inherit_status' = 'inheritable' THEN
        v_atom := v_seed->'proposed_atom';
        IF jsonb_typeof(v_atom) <> 'object'
           OR COALESCE(v_atom->>'board_type', '') = ''
           OR COALESCE(v_atom->>'atom_type', '') = ''
           OR COALESCE(v_atom->>'atom_key', '') = ''
           OR jsonb_typeof(v_atom->'atom_value_jsonb') <> 'object'
           OR COALESCE((v_atom->'conflict_with_initial'->>'has_conflict')::boolean, true) THEN
          RETURN public.v7_error('FUTURE_SETTING_REJECTED', 'Every inheritable future setting needs a complete atom and has_conflict=false.');
        END IF;
      END IF;
    END LOOP;

    IF v_l1a.source_type = 'manual' THEN
      IF v_l1a.participant_chars_json IS NOT NULL
         AND jsonb_typeof(v_l1a.participant_chars_json) <> 'array' THEN
        RETURN public.v7_error('L1A_PARTICIPANT_REFERENCE_REJECTED', 'Manual L1A participants must be a list of this book''s active formal characters.');
      END IF;
      IF v_l1a.world_resistance_refs IS NOT NULL
         AND jsonb_typeof(v_l1a.world_resistance_refs) <> 'array' THEN
        RETURN public.v7_error('L1A_WORLD_REFERENCE_REJECTED', 'Manual L1A world resistances must be a list of this book''s active formal settings.');
      END IF;
      FOR v_participant_ref IN
        SELECT value FROM jsonb_array_elements(COALESCE(v_l1a.participant_chars_json, '[]'::jsonb))
      LOOP
        IF jsonb_typeof(v_participant_ref) <> 'string' OR NOT EXISTS (
          SELECT 1
          FROM public.character AS c
          JOIN public.book_project AS bp ON bp.id = c.book_id
          WHERE c.id::text = (v_participant_ref #>> '{}')
            AND c.book_id = v_book
            AND bp.local_operator_id = v_operator
            AND c.status = 'active'
            AND c.is_active
            AND c.is_formal
            AND c.is_valid
            AND NOT c.is_shadow
        ) THEN
          RETURN public.v7_error('L1A_PARTICIPANT_REFERENCE_REJECTED', 'Manual L1A participants must be this book''s active formal characters.');
        END IF;
      END LOOP;
      FOR v_resistance_ref IN
        SELECT value FROM jsonb_array_elements(COALESCE(v_l1a.world_resistance_refs, '[]'::jsonb))
      LOOP
        IF jsonb_typeof(v_resistance_ref) <> 'object'
           OR COALESCE(v_resistance_ref->>'atom_key', '') = ''
           OR NOT EXISTS (
             SELECT 1
             FROM public.world_state AS ws
             JOIN public.book_project AS bp ON bp.id = ws.book_id
             WHERE ws.book_id = v_book
               AND bp.local_operator_id = v_operator
               AND ws.atom_key = v_resistance_ref->>'atom_key'
               AND ws.is_active
               AND ws.is_formal
               AND ws.is_valid
               AND NOT ws.is_shadow
           ) THEN
          RETURN public.v7_error('L1A_WORLD_REFERENCE_REJECTED', 'Manual L1A world resistances must reference this book''s active formal settings.');
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  SELECT COALESCE(max(l1a_index), 0) + cardinality(v_ids) + 1000
  INTO v_offset
  FROM public.l1a_unit
  WHERE book_id = v_book AND is_valid AND NOT is_shadow;
  PERFORM public.v7_enable_internal_write();
  UPDATE public.l1a_unit
  SET l1a_index = l1a_index + v_offset
  WHERE id = ANY(v_ids);
  UPDATE public.l1a_unit AS l
  SET l1a_index = ordered.ordinal_position::integer
  FROM unnest(v_ids) WITH ORDINALITY AS ordered(id, ordinal_position)
  WHERE l.id = ordered.id;
  FOR v_l1a IN SELECT * FROM public.l1a_unit WHERE id = ANY(v_ids) ORDER BY l1a_index FOR UPDATE
  LOOP
    UPDATE public.l1a_unit
    SET status = 'finalized',
        confirmation_status = 'creator_confirmed',
        is_formal = true,
        is_shadow = false,
        is_valid = true,
        is_locked = true
    WHERE id = v_l1a.id;

    FOR v_seed IN SELECT value FROM jsonb_array_elements(COALESCE(v_l1a.future_setting_seeds, '[]'::jsonb))
    LOOP
      IF v_seed->>'inherit_status' = 'inheritable' THEN
        v_atom := v_seed->'proposed_atom';
        INSERT INTO public.world_state(
          book_id, board_type, atom_type, atom_key, atom_value_jsonb,
          affordance_dims, source_type, setting_layer, origin_l1a_id,
          is_active, is_formal, is_shadow, is_valid, knowledge_boundary_json,
          apply_scope_json, violate_cost_json, chain_change_json, reverse_dep_index,
          reveal_order, l1a_change_log_json, gen_l1a_json, conflict_with_initial
        ) VALUES (
          v_book, v_atom->>'board_type', v_atom->>'atom_type', v_atom->>'atom_key',
          v_atom->'atom_value_jsonb', COALESCE(v_atom->'affordance_dims', '[]'::jsonb),
          COALESCE(v_atom->>'source_type', 'ai_generated'), 'l1a_generated', v_l1a.id,
          false, true, false, true, v_atom->'knowledge_boundary_json',
          v_atom->'apply_scope_json', v_atom->'violate_cost_json',
          v_atom->'chain_change_json', v_atom->'reverse_dep_index',
          NULLIF(v_atom->>'reveal_order', '')::integer, v_atom->'l1a_change_log_json',
          v_atom->'gen_l1a_json', v_atom->'conflict_with_initial'
        ) RETURNING id INTO v_future_id;
        v_future_world_ids := v_future_world_ids || jsonb_build_array(v_future_id);

        FOR v_binding IN SELECT value FROM jsonb_array_elements(COALESCE(v_seed->'proposed_bindings', '[]'::jsonb))
        LOOP
          INSERT INTO public.world_binding(
            book_id, from_ref_type, from_ref_id, to_ref_type, to_ref_id,
            binding_type, binding_strength, setting_layer, origin_l1a_id,
            is_formal, is_shadow, is_valid
          ) VALUES (
            v_book, v_binding->>'from_ref_type', v_binding->>'from_ref_id',
            v_binding->>'to_ref_type', v_binding->>'to_ref_id', v_binding->>'binding_type',
            COALESCE(v_binding->>'binding_strength', 'medium'), 'l1a_generated',
            v_l1a.id, true, false, true
          ) RETURNING id INTO v_future_id;
          v_future_binding_ids := v_future_binding_ids || jsonb_build_array(v_future_id);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.book_project
  SET stage_code = 'production',
      run_status = 'l1a_confirmed'
  WHERE id = v_book;
  INSERT INTO public.writeback_log(
    book_id, chapter_id, chapter_version_id, transaction_id, writeback_scope_jsonb,
    status, source_version_no
  ) VALUES (
    v_book, NULL, NULL, gen_random_uuid(),
    jsonb_build_object('tables', jsonb_build_array('l1a_unit', 'world_state', 'world_binding', 'book_project')),
    'success', 'l1a-finalize'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('l1a_ids', to_jsonb(v_ids), 'future_world_ids', v_future_world_ids, 'future_binding_ids', v_future_binding_ids),
    'state', jsonb_build_object('design_locked', true, 'design_fingerprint', v_current_fingerprint)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_finalize_l1a', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_select_l1a_for_production(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_l1a uuid;
  v_current_l1a uuid;
  v_current_status text;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_l1a := NULLIF(p_request->>'l1a_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id, book_id, and l1a_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF v_l1a IS NULL OR NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A finalized l1a_id and valid idempotency_key are required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_select_l1a_for_production', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  SELECT current_l1a_id INTO v_current_l1a
  FROM public.book_project
  WHERE id = v_book AND local_operator_id = v_operator
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_select_l1a_for_production', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.l1a_unit
    WHERE id = v_l1a
      AND book_id = v_book
      AND status = 'finalized'
      AND confirmation_status = 'creator_confirmed'
      AND is_formal
      AND is_locked
      AND is_valid
      AND NOT is_shadow
  ) THEN
    RETURN public.v7_error('L1A_REJECTED', 'Only a finalized, creator-confirmed L1A from this book can enter production.');
  END IF;

  IF v_current_l1a IS NOT NULL AND v_current_l1a <> v_l1a THEN
    SELECT status INTO v_current_status
    FROM public.l1a_unit
    WHERE id = v_current_l1a
      AND book_id = v_book
      AND is_formal
      AND is_locked
      AND is_valid
      AND NOT is_shadow;
    IF v_current_status IS NULL OR v_current_status NOT IN ('finalized', 'completed') THEN
      RETURN public.v7_error('STATE_REJECTED', 'The unfinished current L1A must be resumed before another L1A can be selected.');
    END IF;
  END IF;

  PERFORM public.v7_enable_internal_write();
  UPDATE public.book_project
  SET current_l1a_id = v_l1a,
      updated_at = now()
  WHERE id = v_book AND local_operator_id = v_operator;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('l1a_id', v_l1a),
    'state', jsonb_build_object('current_l1a_id', v_l1a, 'l1a_status', 'finalized')
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_select_l1a_for_production', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_persist_chapter_execution_plan(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_l1a uuid;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_plan jsonb;
  v_header_id uuid;
  v_version_id uuid;
  v_chapter_ids jsonb := '[]'::jsonb;
  v_chapter_versions jsonb := '[]'::jsonb;
  v_indexes integer[] := ARRAY[]::integer[];
  v_particle jsonb;
  v_reveal_ref jsonb;
  v_step jsonb;
  v_ref jsonb;
  v_lens jsonb;
  v_pov_char text;
  v_switch_rule text;
  v_particle_ids text[];
  v_step_particle_ids text[];
  v_dialogue jsonb;
  v_dialogue_function text;
  v_dialogue_counts jsonb;
  v_can_reveal jsonb;
  v_reveal_index integer;
  v_count integer;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_l1a := NULLIF(p_request->>'l1a_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id, book_id, and l1a_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  IF jsonb_typeof(p_request->'chapter_plans') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'chapter_plans') = 0 THEN
    RETURN public.v7_error('INVALID_REQUEST', 'chapter_plans must contain at least one approved plan.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_persist_chapter_execution_plan', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.l1a_unit AS l
    WHERE l.id = v_l1a AND l.book_id = v_book
      AND l.is_formal AND l.is_locked AND l.is_valid AND NOT l.is_shadow
      AND l.status = 'finalized'
  ) THEN
    RETURN public.v7_error('L1A_NOT_READY', 'A formally confirmed L1A is required before storing chapter plans.');
  END IF;
  SELECT l.info_reveal_boundary->'can_reveal'
  INTO v_can_reveal
  FROM public.l1a_unit AS l
  WHERE l.id = v_l1a AND l.book_id = v_book;
  IF jsonb_typeof(v_can_reveal) IS DISTINCT FROM 'array' THEN
    v_can_reveal := '[]'::jsonb;
  END IF;

  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_request->'chapter_plans')
  LOOP
    v_particle_ids := ARRAY[]::text[];
    v_step_particle_ids := ARRAY[]::text[];
    IF COALESCE(v_plan->>'chapter_index', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(v_plan->>'title', '') = ''
       OR jsonb_typeof(v_plan->'target_snapshot_json') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package') IS DISTINCT FROM 'object'
       OR NOT (v_plan->'target_snapshot_json'->'scene_condition_package' ?& ARRAY[
         'scene_location', 'participant_chars', 'rule_locks', 'scene_affordance',
         'available_resource_codes', 'info_reveal_candidates', 'chain_reaction_candidates',
         'scene_constraints', 'forbid_lines_active', 'materialize_notes'
       ])
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'participant_chars') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'rule_locks') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'scene_affordance') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'available_resource_codes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'info_reveal_candidates') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'chain_reaction_candidates') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'scene_constraints') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'forbid_lines_active') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'scene_condition_package'->'materialize_notes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'chapter_implementation_json') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'core_plot_tasks') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'emotion_goals') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'hook_tasks') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'forbid_content') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'particles_json') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_plan->'target_snapshot_json'->'particles_json') = 0
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'pov_declaration') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'pov_declaration'->'pov_boundaries') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'pov_declaration'->'pov_boundaries'->'can_perceive') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'pov_declaration'->'pov_boundaries'->'can_misjudge') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'target_snapshot_json'->'pov_declaration'->'pov_boundaries'->'must_ignore') IS DISTINCT FROM 'array'
       OR COALESCE(btrim(v_plan #>> '{target_snapshot_json,pov_declaration,pov_char}'), '') = ''
       OR COALESCE(btrim(v_plan #>> '{target_snapshot_json,pov_declaration,switch_rule}'), '') = ''
       OR jsonb_typeof(v_plan->'chapter_implementation_json'->'execution_steps') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_plan->'chapter_implementation_json'->'execution_steps') = 0
       OR jsonb_typeof(v_plan->'chapter_implementation_json'->'lens_order') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_plan->'chapter_implementation_json'->'lens_order') = 0
       OR jsonb_typeof(v_plan->'chapter_implementation_json'->'dialogue_plan') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_plan->'chapter_implementation_json'->'dialogue_coverage') IS DISTINCT FROM 'object' THEN
      RETURN public.v7_error('PLAN_INCOMPLETE', 'Every chapter plan needs a complete target snapshot, POV boundary, particle set, and implementation plan.');
    END IF;
    IF jsonb_array_length(v_plan #> '{target_snapshot_json,forbid_content}') <> 0 THEN
      RETURN public.v7_error('PLAN_INCOMPLETE', 'A chapter forbidden-content list requires a defined explicit L1A prohibited bridge.');
    END IF;
    v_dialogue_counts := jsonb_build_object(
      'D-01', 0, 'D-02', 0, 'D-03', 0, 'D-04', 0,
      'D-05', 0, 'D-06', 0, 'D-07', 0, 'D-08', 0
    );
    FOR v_dialogue IN SELECT value FROM jsonb_array_elements(v_plan->'chapter_implementation_json'->'dialogue_plan')
    LOOP
      IF jsonb_typeof(v_dialogue) IS DISTINCT FROM 'object'
         OR COALESCE(v_dialogue->>'primary_function', '') NOT IN ('D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08')
         OR COALESCE(v_dialogue->>'secondary_function', '') NOT IN ('D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', '无')
         OR v_dialogue->>'primary_function' = v_dialogue->>'secondary_function' THEN
        RETURN public.v7_error('PLAN_INCOMPLETE', 'Dialogue plans must declare distinct documented D-01 to D-08 functions.');
      END IF;
      v_dialogue_function := v_dialogue->>'primary_function';
      v_dialogue_counts := jsonb_set(v_dialogue_counts, ARRAY[v_dialogue_function], to_jsonb((v_dialogue_counts->>v_dialogue_function)::integer + 1));
      IF v_dialogue->>'secondary_function' <> '无' THEN
        v_dialogue_function := v_dialogue->>'secondary_function';
        v_dialogue_counts := jsonb_set(v_dialogue_counts, ARRAY[v_dialogue_function], to_jsonb((v_dialogue_counts->>v_dialogue_function)::integer + 1));
      END IF;
    END LOOP;
    IF NOT (v_plan->'chapter_implementation_json'->'dialogue_coverage' ?& ARRAY['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08'])
       OR (SELECT count(*) FROM jsonb_object_keys(v_plan->'chapter_implementation_json'->'dialogue_coverage')) <> 8
       OR EXISTS (
         SELECT 1
         FROM jsonb_each_text(v_plan->'chapter_implementation_json'->'dialogue_coverage') AS coverage(code, value)
         WHERE value !~ '^[0-9]+$'
            OR value::integer <> (v_dialogue_counts->>code)::integer
       )
       OR (v_dialogue_counts->>'D-01')::integer < 1
       OR (v_dialogue_counts->>'D-02')::integer < 1
       OR (v_dialogue_counts->>'D-03')::integer < 1 THEN
      RETURN public.v7_error('PLAN_INCOMPLETE', 'Dialogue coverage must exactly match the plan and include D-01, D-02, and D-03.');
    END IF;
    v_pov_char := btrim(v_plan #>> '{target_snapshot_json,pov_declaration,pov_char}');
    v_switch_rule := btrim(v_plan #>> '{target_snapshot_json,pov_declaration,switch_rule}');
    FOR v_lens IN SELECT value FROM jsonb_array_elements(v_plan->'chapter_implementation_json'->'lens_order')
    LOOP
      IF jsonb_typeof(v_lens) IS DISTINCT FROM 'object'
         OR COALESCE(btrim(v_lens->>'pov'), '') = ''
         OR COALESCE(btrim(v_lens->>'sensory'), '') NOT IN ('视觉', '听觉', '嗅觉', '触觉', '味觉')
         OR (v_switch_rule = '无' AND btrim(v_lens->>'pov') <> v_pov_char) THEN
        RETURN public.v7_error('PLAN_INCOMPLETE', 'POV declarations and lens order must agree before a chapter plan can be stored.');
      END IF;
    END LOOP;
    FOR v_particle IN SELECT value FROM jsonb_array_elements(v_plan->'target_snapshot_json'->'particles_json')
    LOOP
      IF jsonb_typeof(v_particle) IS DISTINCT FROM 'object'
         OR COALESCE(v_particle->>'particle_id', '') = ''
         OR COALESCE(v_particle->>'content', '') = ''
         OR COALESCE(v_particle->>'type', '') NOT IN ('truth', 'resource', 'info', 'emotion', 'hook')
         OR COALESCE(v_particle->>'source_field', '') = ''
         OR COALESCE(v_particle->>'purpose', '') = ''
          OR COALESCE(jsonb_typeof(v_particle->'reveal_to'), '') NOT IN ('string', 'array')
         OR (
           v_particle->>'type' = 'resource'
           AND v_particle->'world_verified' IS DISTINCT FROM 'true'::jsonb
         ) THEN
         RETURN public.v7_error('PLAN_INCOMPLETE', 'Every persisted L1A particle must preserve its V7 identity, source, purpose, reveal scope, and resource verification.');
      END IF;
      IF jsonb_typeof(v_particle->'reveal_to') = 'string' THEN
        IF v_particle->>'reveal_to' NOT IN ('all', 'reader') THEN
          RETURN public.v7_error('PLAN_INCOMPLETE', 'Every persisted L1A particle reveal scope must be all, reader, or current-book formal character IDs.');
        END IF;
      ELSE
        IF jsonb_array_length(v_particle->'reveal_to') = 0 THEN
          RETURN public.v7_error('PLAN_INCOMPLETE', 'Every persisted L1A particle reveal scope must be all, reader, or current-book formal character IDs.');
        END IF;
        FOR v_reveal_ref IN SELECT value FROM jsonb_array_elements(v_particle->'reveal_to')
        LOOP
          IF jsonb_typeof(v_reveal_ref) IS DISTINCT FROM 'string'
             OR COALESCE(v_reveal_ref #>> '{}', '') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
            RETURN public.v7_error('PLAN_INCOMPLETE', 'Every persisted L1A particle reveal scope must be all, reader, or current-book formal character IDs.');
          END IF;
          IF NOT EXISTS (
            SELECT 1
            FROM public.v_character_active AS c
            WHERE c.book_id = v_book
              AND c.local_operator_id = v_operator
              AND c.id = (v_reveal_ref #>> '{}')::uuid
          ) THEN
            RETURN public.v7_error('PLAN_INCOMPLETE', 'Every persisted L1A particle reveal scope must be all, reader, or current-book formal character IDs.');
          END IF;
        END LOOP;
      END IF;
      IF (v_particle->>'particle_id') = ANY(v_particle_ids) THEN
        RETURN public.v7_error('PLAN_INCOMPLETE', 'Particle identifiers must be unique inside one chapter target.');
      END IF;
      IF v_particle->>'source_field' ~ '^info_reveal_boundary[.]can_reveal[[]([0-9]+)[]]$' THEN
        v_reveal_index := substring(v_particle->>'source_field' FROM '^info_reveal_boundary[.]can_reveal[[]([0-9]+)[]]$')::integer;
        IF v_can_reveal->v_reveal_index IS NULL
           OR jsonb_typeof(v_can_reveal->v_reveal_index) <> 'string'
           OR v_particle->>'content' <> v_can_reveal->>v_reveal_index THEN
          RETURN public.v7_error('PLAN_INCOMPLETE', 'An info_reveal_boundary.can_reveal particle must exactly match the current L1A source value.');
        END IF;
      END IF;
      v_particle_ids := array_append(v_particle_ids, v_particle->>'particle_id');
    END LOOP;
    FOR v_step IN SELECT value FROM jsonb_array_elements(v_plan->'chapter_implementation_json'->'execution_steps')
    LOOP
      IF jsonb_typeof(v_step) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_step->'core_particles') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_step->'core_particles') = 0 THEN
        RETURN public.v7_error('PLAN_INCOMPLETE', 'Every execution step must reference at least one core particle.');
      END IF;
      FOR v_ref IN SELECT value FROM jsonb_array_elements(v_step->'core_particles')
      LOOP
        IF jsonb_typeof(v_ref) IS DISTINCT FROM 'string'
           OR COALESCE(v_ref #>> '{}', '') = ''
           OR (v_ref #>> '{}') = ANY(v_step_particle_ids) THEN
          RETURN public.v7_error('PLAN_INCOMPLETE', 'Execution steps must reference each core particle exactly once.');
        END IF;
        v_step_particle_ids := array_append(v_step_particle_ids, v_ref #>> '{}');
      END LOOP;
    END LOOP;
    IF cardinality(v_particle_ids) <> cardinality(v_step_particle_ids)
       OR EXISTS (
         SELECT value FROM unnest(v_particle_ids) AS value
         EXCEPT
         SELECT value FROM unnest(v_step_particle_ids) AS value
       ) THEN
      RETURN public.v7_error('PLAN_INCOMPLETE', 'The execution plan must map every target particle exactly once and cannot invent particle identifiers.');
    END IF;
    v_indexes := array_append(v_indexes, (v_plan->>'chapter_index')::integer);
  END LOOP;
  IF cardinality(v_indexes) <> (SELECT count(DISTINCT x) FROM unnest(v_indexes) AS x)
     OR EXISTS (SELECT 1 FROM public.chapter_header WHERE book_id = v_book AND chapter_index = ANY(v_indexes)) THEN
    RETURN public.v7_error('CHAPTER_INDEX_REJECTED', 'Chapter indexes must be unique and never reused within a book.');
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_persist_chapter_execution_plan', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.l1a_unit
    WHERE id = v_l1a AND book_id = v_book
      AND is_formal AND is_locked AND is_valid AND NOT is_shadow
      AND status = 'finalized'
  ) THEN
    RETURN public.v7_error('L1A_SCOPE_REJECTED', 'Only a finalized L1A in this book can be selected for chapter execution.');
  END IF;
  PERFORM public.v7_enable_internal_write();
  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_request->'chapter_plans')
  LOOP
    v_header_id := gen_random_uuid();
    v_version_id := gen_random_uuid();
    INSERT INTO public.chapter_header(
      id, book_id, l1a_unit_id, chapter_index, title, status, run_status,
      is_finalized, confirmation_status
    ) VALUES (
      v_header_id, v_book, v_l1a, (v_plan->>'chapter_index')::integer,
      v_plan->>'title', 'plan_ready', 'plan_ready', false, 'unconfirmed'
    );
    INSERT INTO public.chapter_version(
      id, book_id, chapter_id, version_no, version_state, is_shadow, is_formal,
      is_valid, target_snapshot_json, chapter_implementation_json,
      exception_summary_jsonb
    ) VALUES (
      v_version_id, v_book, v_header_id, 1, 'candidate', false, false, true,
      v_plan->'target_snapshot_json', v_plan->'chapter_implementation_json',
      v_plan->'exception_summary_jsonb'
    );
    v_chapter_ids := v_chapter_ids || jsonb_build_array(v_header_id);
    v_chapter_versions := v_chapter_versions || jsonb_build_array(jsonb_build_object(
      'chapter_id', v_header_id,
      'chapter_version_id', v_version_id
    ));
  END LOOP;

  UPDATE public.l1a_unit
  SET status = 'locked_for_deduction',
      chapter_nos_json = jsonb_build_object('chapter_indexes', to_jsonb(v_indexes), 'chapter_ids', v_chapter_ids)
  WHERE id = v_l1a;
  UPDATE public.book_project
  SET current_l1a_id = v_l1a,
      run_status = 'plan_ready',
      active_l1a_json = jsonb_build_object('l1a_id', v_l1a, 'chapter_ids', v_chapter_ids)
  WHERE id = v_book;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('chapter_ids', v_chapter_ids, 'chapter_versions', v_chapter_versions),
    'state', jsonb_build_object('l1a_status', 'locked_for_deduction', 'run_status', 'plan_ready')
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_persist_chapter_execution_plan', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_deduction_snapshot(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_l1a uuid;
  v_action text := COALESCE(NULLIF(p_request->>'action', ''), 'snapshot');
  v_return_direction text := NULLIF(btrim(p_request->>'return_direction'), '');
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_chapter_input jsonb;
  v_update jsonb;
  v_input_chapter uuid;
  v_input_version uuid;
  v_header public.chapter_header%ROWTYPE;
  v_version public.chapter_version%ROWTYPE;
  v_progress jsonb;
  v_plot jsonb;
  v_candidate_truth_ledger jsonb;
  v_token_consumed bigint;
  v_remaining integer;
  v_current_index integer;
  v_reject_count integer;
  v_complete boolean;
  v_budget bigint;
  v_requested_tokens bigint := 0;
  v_all_complete boolean := true;
  v_any_budget_exceeded boolean := false;
  v_active_count integer;
  v_status text;
  v_target_particles jsonb;
  v_deduction_input_snapshot jsonb;
  v_deduction_particles jsonb;
  v_target_count integer;
  v_records jsonb;
  v_record jsonb;
  v_ledger_entry jsonb;
  v_expected_particle jsonb;
  v_selected_event_ids text[];
  v_record_index integer;
  v_previous_index integer := 0;
  v_previous_tokens bigint := 0;
  v_previous_records jsonb;
  v_previous_input_snapshot jsonb;
  v_previous_count integer := 0;
  v_prefix_index integer;
  v_updates jsonb := '[]'::jsonb;
  v_chapter_states jsonb := '[]'::jsonb;
  v_replan_versions jsonb := '[]'::jsonb;
  v_successor_version_id uuid;
  v_successor_version_no integer;
  v_total_chapters integer := 0;
  v_active_chapters integer := 0;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_l1a := NULLIF(p_request->>'l1a_unit_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The deduction scope identifiers are invalid.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;

  IF v_action NOT IN ('snapshot', 'replan', 'restart') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The deduction persistence action is unavailable.');
  END IF;

  IF v_action = 'restart' AND NOT public.v7_valid_idempotency_key(v_key) THEN
    v_key := 'fp008-technical-restart:' || gen_random_uuid()::text;
  END IF;

  IF v_action = 'replan' THEN
    IF v_l1a IS NULL OR NOT public.v7_valid_idempotency_key(v_key) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'A current L1A and a valid idempotency_key are required for deduction replan.');
    END IF;
    IF v_return_direction IS NULL THEN
      RETURN public.v7_error('RETURN_DIRECTION_REQUIRED', 'A non-empty creator direction is required to replan this L1A.');
    END IF;

    v_result := public.v7_replay_product_request(
      'rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request)
    );
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;

    PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
    v_result := public.v7_replay_product_request(
      'rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request)
    );
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.book_project
      WHERE id = v_book
        AND current_l1a_id = v_l1a
        AND token_budget = 3000000
        AND token_budget_version = 'mvp-fixed-3000000'
    ) THEN
      RETURN public.v7_error('L1A_SCOPE_REJECTED', 'Only the current L1A with the fixed deduction budget can be replanned.');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.l1a_unit
      WHERE id = v_l1a
        AND book_id = v_book
        AND status = 'locked_for_deduction'
        AND is_formal
        AND is_locked
        AND is_valid
        AND NOT is_shadow
    ) THEN
      RETURN public.v7_error('L1A_SCOPE_REJECTED', 'The selected L1A is not available for deduction replan.');
    END IF;

    SELECT count(*) INTO v_total_chapters
    FROM public.chapter_header AS h
    WHERE h.book_id = v_book
      AND h.l1a_unit_id = v_l1a;
    SELECT count(*) INTO v_active_chapters
    FROM public.chapter_header AS h
    JOIN public.chapter_version AS cv
      ON cv.chapter_id = h.id
     AND cv.book_id = h.book_id
     AND cv.version_state = 'candidate'
     AND cv.is_valid
     AND NOT cv.is_shadow
    WHERE h.book_id = v_book
      AND h.l1a_unit_id = v_l1a
      AND NOT h.is_finalized;
    IF v_total_chapters = 0 OR v_active_chapters <> v_total_chapters THEN
      RETURN public.v7_error('L1A_CHAPTER_SCOPE_REJECTED', 'The current L1A no longer has one active candidate per unfinalized chapter.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.chapter_header AS h
      JOIN public.chapter_version AS cv
        ON cv.chapter_id = h.id
       AND cv.book_id = h.book_id
       AND cv.version_state = 'candidate'
       AND cv.is_valid
       AND NOT cv.is_shadow
      WHERE h.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND cv.candidate_plot_sim_json IS NULL
        AND cv.deduction_progress_json IS NULL
    ) THEN
      RETURN public.v7_error('DEDUCTION_REPLAN_NOT_AVAILABLE', 'Creator-directed deduction replan requires a saved deduction snapshot or checkpoint to replace.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.chapter_header AS h
      JOIN public.chapter_version AS cv
        ON cv.chapter_id = h.id
       AND cv.book_id = h.book_id
       AND cv.version_state = 'candidate'
       AND cv.is_valid
       AND NOT cv.is_shadow
      WHERE h.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND (cv.prose_text IS NOT NULL OR cv.prose_summary IS NOT NULL)
    ) OR EXISTS (
      SELECT 1
      FROM public.audit_attempt_log AS a
      JOIN public.chapter_header AS h ON h.id = a.chapter_id
      WHERE a.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND a.is_valid
        AND NOT a.is_shadow
    ) THEN
      RETURN public.v7_error('DEDUCTION_REPLAN_NOT_AVAILABLE', 'Creator-directed deduction replan is only available before candidate prose or objective audit begins.');
    END IF;

    PERFORM public.v7_enable_internal_write();
    FOR v_chapter_input IN
      SELECT jsonb_build_object(
        'chapter_id', h.id,
        'chapter_version_id', cv.id
      )
      FROM public.chapter_header AS h
      JOIN public.chapter_version AS cv
        ON cv.chapter_id = h.id
       AND cv.book_id = h.book_id
       AND cv.version_state = 'candidate'
       AND cv.is_valid
       AND NOT cv.is_shadow
      WHERE h.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND NOT h.is_finalized
      ORDER BY h.chapter_index
      FOR UPDATE OF h, cv
    LOOP
      v_input_chapter := (v_chapter_input->>'chapter_id')::uuid;
      v_input_version := (v_chapter_input->>'chapter_version_id')::uuid;
      SELECT * INTO v_version
      FROM public.chapter_version
      WHERE id = v_input_version;
      v_successor_version_id := gen_random_uuid();
      v_successor_version_no := v_version.version_no + 1;

      UPDATE public.chapter_version
      SET version_state = 'shadow', is_shadow = true, is_formal = false, is_valid = false
      WHERE id = v_input_version;
      INSERT INTO public.chapter_version(
        id, book_id, chapter_id, version_no, predecessor_version_id,
        version_state, is_shadow, is_formal, is_valid,
        target_snapshot_json, chapter_implementation_json,
        deduction_locked, exception_summary_jsonb
      ) VALUES (
        v_successor_version_id, v_book, v_input_chapter, v_successor_version_no, v_input_version,
        'candidate', false, false, true,
        v_version.target_snapshot_json, v_version.chapter_implementation_json,
        false, v_version.exception_summary_jsonb
      );
      UPDATE public.chapter_header
      SET status = 'plan_ready', run_status = 'plan_ready', is_finalized = false,
          confirmation_status = 'unconfirmed', word_count = 0
      WHERE id = v_input_chapter;
      v_replan_versions := v_replan_versions || jsonb_build_array(jsonb_build_object(
        'chapter_id', v_input_chapter,
        'archived_chapter_version_id', v_input_version,
        'successor_chapter_version_id', v_successor_version_id
      ));
    END LOOP;

    v_result := jsonb_build_object(
      'ok', true,
      'book_id', v_book,
      'ids', jsonb_build_object('chapter_versions', v_replan_versions),
      'state', jsonb_build_object(
        'action', 'replan',
        'deduction_locked', false,
        'token_consumed', 0,
        'token_budget', 3000000
      )
    );
    INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
    VALUES ('rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
    RETURN v_result;
  END IF;

  IF v_action = 'restart' THEN
    IF v_l1a IS NULL OR v_return_direction IS NOT NULL THEN
      RETURN public.v7_error('INVALID_REQUEST', 'Technical deduction restart requires only the current L1A scope.');
    END IF;

    PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.book_project
      WHERE id = v_book
        AND current_l1a_id = v_l1a
        AND token_budget = 3000000
        AND token_budget_version = 'mvp-fixed-3000000'
    ) THEN
      RETURN public.v7_error('L1A_SCOPE_REJECTED', 'Only the current L1A with the fixed deduction budget can restart.');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.l1a_unit
      WHERE id = v_l1a
        AND book_id = v_book
        AND status = 'locked_for_deduction'
        AND is_formal
        AND is_locked
        AND is_valid
        AND NOT is_shadow
    ) THEN
      RETURN public.v7_error('L1A_SCOPE_REJECTED', 'The selected L1A is not available for technical restart.');
    END IF;

    SELECT count(*) INTO v_total_chapters
    FROM public.chapter_header AS h
    WHERE h.book_id = v_book
      AND h.l1a_unit_id = v_l1a;
    SELECT count(*) INTO v_active_chapters
    FROM public.chapter_header AS h
    JOIN public.chapter_version AS cv
      ON cv.chapter_id = h.id
     AND cv.book_id = h.book_id
     AND cv.version_state = 'candidate'
     AND cv.is_valid
     AND NOT cv.is_shadow
    WHERE h.book_id = v_book
      AND h.l1a_unit_id = v_l1a
      AND NOT h.is_finalized;
    IF v_total_chapters = 0 OR v_active_chapters <> v_total_chapters THEN
      RETURN public.v7_error('L1A_CHAPTER_SCOPE_REJECTED', 'The current L1A no longer has one active candidate per unfinalized chapter.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.chapter_header AS h
      JOIN public.chapter_version AS cv
        ON cv.chapter_id = h.id
       AND cv.book_id = h.book_id
       AND cv.version_state = 'candidate'
       AND cv.is_valid
       AND NOT cv.is_shadow
      WHERE h.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND (cv.prose_text IS NOT NULL OR cv.prose_summary IS NOT NULL)
    ) OR EXISTS (
      SELECT 1
      FROM public.audit_attempt_log AS a
      JOIN public.chapter_header AS h ON h.id = a.chapter_id
      WHERE a.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND a.is_valid
        AND NOT a.is_shadow
    ) THEN
      RETURN public.v7_error('DEDUCTION_RESTART_NOT_AVAILABLE', 'Technical deduction restart is only available before candidate prose or objective audit begins.');
    END IF;

    PERFORM public.v7_enable_internal_write();
    FOR v_chapter_input IN
      SELECT jsonb_build_object(
        'chapter_id', h.id,
        'chapter_version_id', cv.id
      )
      FROM public.chapter_header AS h
      JOIN public.chapter_version AS cv
        ON cv.chapter_id = h.id
       AND cv.book_id = h.book_id
       AND cv.version_state = 'candidate'
       AND cv.is_valid
       AND NOT cv.is_shadow
      WHERE h.book_id = v_book
        AND h.l1a_unit_id = v_l1a
        AND NOT h.is_finalized
      ORDER BY h.chapter_index
      FOR UPDATE OF h, cv
    LOOP
      v_input_chapter := (v_chapter_input->>'chapter_id')::uuid;
      v_input_version := (v_chapter_input->>'chapter_version_id')::uuid;
      UPDATE public.chapter_version
      SET candidate_plot_sim_json = NULL,
          deduction_progress_json = NULL,
          deduction_locked = false
      WHERE id = v_input_version;
      UPDATE public.chapter_header
      SET status = 'plan_ready',
          run_status = 'plan_ready',
          is_finalized = false
      WHERE id = v_input_chapter;
      v_chapter_states := v_chapter_states || jsonb_build_array(jsonb_build_object(
        'chapter_id', v_input_chapter,
        'chapter_version_id', v_input_version,
        'deduction_locked', false
      ));
    END LOOP;

    v_result := jsonb_build_object(
      'ok', true,
      'book_id', v_book,
      'ids', jsonb_build_object('l1a_unit_id', v_l1a, 'chapters', v_chapter_states),
      'state', jsonb_build_object(
        'action', 'restart',
        'status', 'plan_ready',
        'deduction_locked', false,
        'token_consumed', 0,
        'token_budget', 3000000
      )
    );
    INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
    VALUES ('rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
    RETURN v_result;
  END IF;

  IF v_l1a IS NULL
     OR NOT public.v7_valid_idempotency_key(v_key)
     OR jsonb_typeof(p_request->'chapters') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_request->'chapters') = 0 THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A current L1A, its complete chapter snapshots, and a valid idempotency_key are required.');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'chapter_id' AS chapter_id, value->>'chapter_version_id' AS chapter_version_id, count(*) AS duplicate_count
      FROM jsonb_array_elements(p_request->'chapters') AS item(value)
      GROUP BY value->>'chapter_id', value->>'chapter_version_id'
      HAVING count(*) > 1
    ) AS duplicates
  ) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'Each L1A chapter snapshot may appear only once.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_project
    WHERE id = v_book AND current_l1a_id = v_l1a
  ) THEN
    RETURN public.v7_error('L1A_SCOPE_REJECTED', 'Only the book current L1A can persist a deduction snapshot.');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.l1a_unit
    WHERE id = v_l1a
      AND book_id = v_book
      AND status = 'locked_for_deduction'
      AND is_formal
      AND is_locked
      AND is_valid
      AND NOT is_shadow
  ) THEN
    RETURN public.v7_error('L1A_SCOPE_REJECTED', 'The selected L1A is not available for deduction persistence.');
  END IF;
  SELECT count(*) INTO v_active_count
  FROM public.chapter_header AS h
  JOIN public.chapter_version AS cv
    ON cv.chapter_id = h.id
   AND cv.book_id = h.book_id
   AND cv.version_state = 'candidate'
   AND cv.is_valid
   AND NOT cv.is_shadow
  WHERE h.book_id = v_book
    AND h.l1a_unit_id = v_l1a
    AND NOT h.is_finalized;
  IF v_active_count <> jsonb_array_length(p_request->'chapters') THEN
    RETURN public.v7_error('L1A_CHAPTER_SCOPE_REJECTED', 'A deduction checkpoint must include every current chapter in the selected L1A.');
  END IF;

  FOR v_chapter_input IN SELECT value FROM jsonb_array_elements(p_request->'chapters') AS item(value)
  LOOP
    v_plot := v_chapter_input->'candidate_plot_sim_json';
    v_progress := v_chapter_input->'deduction_progress_json';
    v_deduction_input_snapshot := v_plot->'deduction_input_snapshot';
    v_candidate_truth_ledger := v_plot->'candidate_truth_ledger';
    BEGIN
      v_input_chapter := NULLIF(v_chapter_input->>'chapter_id', '')::uuid;
      v_input_version := NULLIF(v_chapter_input->>'chapter_version_id', '')::uuid;
      v_token_consumed := NULLIF(v_progress->>'token_consumed', '')::bigint;
      v_remaining := NULLIF(v_progress->>'remaining_particles', '')::integer;
      v_current_index := NULLIF(v_progress->>'current_particle_index', '')::integer;
      v_reject_count := NULLIF(v_progress->>'reject_count', '')::integer;
      v_complete := NULLIF(v_progress->>'deduction_complete', '')::boolean;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'The deduction chapter identifiers and progress values are invalid.');
    END;
    IF v_input_chapter IS NULL
       OR v_input_version IS NULL
       OR jsonb_typeof(v_plot) IS DISTINCT FROM 'object'
       OR NOT (v_plot ?& ARRAY['deduction_input_snapshot', 'particles_records', 'chapter_summary'])
       OR jsonb_typeof(v_deduction_input_snapshot) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_deduction_input_snapshot->'particles') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_deduction_input_snapshot->'particles') = 0
       OR jsonb_typeof(v_deduction_input_snapshot->'participating_chars') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_deduction_input_snapshot->'participating_chars') = 0
       OR jsonb_typeof(v_plot->'particles_records') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_candidate_truth_ledger) IS DISTINCT FROM 'object'
       OR NOT (v_candidate_truth_ledger ?& ARRAY[
         'schema_version', 'world_changes', 'character_live_state_changes', 'relation_changes', 'memories'
       ])
       OR jsonb_typeof(v_candidate_truth_ledger->'schema_version') IS DISTINCT FROM 'number'
       OR (v_candidate_truth_ledger->>'schema_version')::integer <> 1
       OR jsonb_typeof(v_candidate_truth_ledger->'world_changes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_candidate_truth_ledger->'character_live_state_changes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_candidate_truth_ledger->'relation_changes') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_candidate_truth_ledger->'memories') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_progress) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_progress->'current_particle_index') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_progress->'token_consumed') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_progress->'remaining_particles') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_progress->'deduction_complete') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_progress->'reject_count') IS DISTINCT FROM 'number'
       OR COALESCE(v_progress->>'current_particle_index', '') !~ '^[0-9]+$'
       OR COALESCE(v_progress->>'token_consumed', '') !~ '^[0-9]+$'
       OR COALESCE(v_progress->>'remaining_particles', '') !~ '^[0-9]+$'
       OR COALESCE(v_progress->>'reject_count', '') !~ '^[0-9]+$'
       OR v_token_consumed IS NULL
       OR v_token_consumed < 0
       OR v_remaining IS NULL
       OR v_remaining < 0
       OR v_current_index IS NULL
       OR v_current_index < 0
       OR v_reject_count IS NULL
       OR v_reject_count < 0
       OR v_complete IS NULL THEN
      RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'The released deduction snapshot and progress are incomplete.');
    END IF;

    SELECT * INTO v_header
    FROM public.chapter_header
    WHERE id = v_input_chapter AND book_id = v_book AND l1a_unit_id = v_l1a
    FOR UPDATE;
    IF NOT FOUND OR v_header.is_finalized THEN
      RETURN public.v7_error('CHAPTER_REJECTED', 'The chapter is unavailable for deduction persistence.');
    END IF;

    SELECT * INTO v_version
    FROM public.chapter_version
    WHERE id = v_input_version
      AND chapter_id = v_input_chapter
      AND book_id = v_book
      AND version_state = 'candidate'
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('VERSION_REJECTED', 'The deduction snapshot must target the current candidate version.');
    END IF;

    v_target_particles := v_version.target_snapshot_json->'particles_json';
    v_deduction_particles := v_deduction_input_snapshot->'particles';
    v_records := v_plot->'particles_records';
    IF jsonb_typeof(v_target_particles) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_target_particles) = 0 THEN
      RETURN public.v7_error('DEDUCTION_TARGET_INCOMPLETE', 'The candidate chapter has no persisted particle target to verify.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_deduction_particles) AS particle(value)
      WHERE jsonb_typeof(particle.value) IS DISTINCT FROM 'object'
         OR NULLIF(btrim(particle.value->>'particle_id'), '') IS NULL
    ) OR (
      SELECT count(DISTINCT particle.value->>'particle_id')
      FROM jsonb_array_elements(v_deduction_particles) AS particle(value)
    ) <> jsonb_array_length(v_deduction_particles) THEN
      RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'The persisted deduction input must contain uniquely identified particles.');
    END IF;
    v_target_count := jsonb_array_length(v_deduction_particles);
    IF v_current_index > v_target_count
       OR v_remaining <> v_target_count - v_current_index
       OR jsonb_array_length(v_records) <> v_current_index
       OR (v_remaining = 0) <> v_complete
       OR (
         v_complete
         AND (
           jsonb_typeof(v_plot->'chapter_summary') IS DISTINCT FROM 'object'
           OR v_plot->'chapter_summary' = '{}'::jsonb
         )
       ) THEN
      RETURN public.v7_error('DEDUCTION_PROGRESS_INCONSISTENT', 'The checkpoint index, completed records, remaining count, completion flag, and chapter summary must describe the same particle progress.');
    END IF;
    FOR v_record, v_record_index IN
      SELECT value, ordinal_position::integer
      FROM jsonb_array_elements(v_records) WITH ORDINALITY AS item(value, ordinal_position)
    LOOP
      SELECT value INTO v_expected_particle
      FROM jsonb_array_elements(v_deduction_particles) WITH ORDINALITY AS item(value, ordinal_position)
      WHERE ordinal_position = v_record_index;
      IF jsonb_typeof(v_record) IS DISTINCT FROM 'object'
         OR COALESCE(v_record->>'particle_id', '') <> COALESCE(v_expected_particle->>'particle_id', '')
         OR COALESCE(v_record->>'particle_status', '') <> 'completed'
         OR COALESCE(jsonb_typeof(v_record->'particle_completion_evidence'), '') <> 'array'
         OR jsonb_array_length(v_record->'particle_completion_evidence') = 0
         OR jsonb_typeof(v_record->'particles_completed') IS DISTINCT FROM 'number'
         OR COALESCE(v_record->>'particles_completed', '') <> v_record_index::text
         OR jsonb_typeof(v_record->'remaining_particles') IS DISTINCT FROM 'number'
         OR COALESCE(v_record->>'remaining_particles', '') <> (v_target_count - v_record_index)::text
         OR v_record->'deduction_complete' IS DISTINCT FROM to_jsonb(v_record_index = v_target_count) THEN
        RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'Every completed particle must follow target order and carry matching completion evidence and counters.');
      END IF;
    END LOOP;

    SELECT COALESCE(array_agg(DISTINCT event.value->>'event_id'), ARRAY[]::text[])
    INTO v_selected_event_ids
    FROM jsonb_array_elements(v_records) AS record(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(record.value->'events_in_round') = 'array'
        THEN record.value->'events_in_round'
        ELSE '[]'::jsonb
      END
    ) AS event(value)
    WHERE NULLIF(btrim(event.value->>'event_id'), '') IS NOT NULL;

    FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_candidate_truth_ledger->'world_changes')
    LOOP
      IF jsonb_typeof(v_ledger_entry) IS DISTINCT FROM 'object'
         OR COALESCE(v_ledger_entry->>'world_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_ledger_entry->'before') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'after') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'event_ids') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_ledger_entry->'event_ids') = 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_ledger_entry->'event_ids') AS event(event_id)
           WHERE NULLIF(btrim(event.event_id), '') IS NULL
              OR NOT (event.event_id = ANY(v_selected_event_ids))
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.world_state AS world
           WHERE world.id = (v_ledger_entry->>'world_state_id')::uuid
             AND world.book_id = v_book
             AND world.is_formal
             AND world.is_active
             AND world.is_valid
             AND NOT world.is_shadow
         ) THEN
        RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'Every candidate world change needs a current formal entity, before/after values, and selected-event evidence.');
      END IF;
    END LOOP;

    FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_candidate_truth_ledger->'character_live_state_changes')
    LOOP
      IF jsonb_typeof(v_ledger_entry) IS DISTINCT FROM 'object'
         OR COALESCE(v_ledger_entry->>'character_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){2}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_ledger_entry->'before') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'after') IS DISTINCT FROM 'object'
         OR COALESCE(btrim(v_ledger_entry->>'change_type'), '') = ''
         OR jsonb_typeof(v_ledger_entry->'change_layer') IS DISTINCT FROM 'number'
         OR (v_ledger_entry->>'change_layer')::integer NOT BETWEEN 0 AND 3
         OR COALESCE(btrim(v_ledger_entry->>'change_reason'), '') = ''
         OR jsonb_typeof(v_ledger_entry->'event_ids') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_ledger_entry->'event_ids') = 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_ledger_entry->'event_ids') AS event(event_id)
           WHERE NULLIF(btrim(event.event_id), '') IS NULL
              OR NOT (event.event_id = ANY(v_selected_event_ids))
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.character AS character
           WHERE character.id = (v_ledger_entry->>'character_id')::uuid
             AND character.book_id = v_book
             AND character.is_formal
             AND character.is_active
             AND character.is_valid
             AND NOT character.is_shadow
         ) THEN
        RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'Every candidate character change needs a current formal role, before/after values, layer, and selected-event evidence.');
      END IF;
    END LOOP;

    FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_candidate_truth_ledger->'relation_changes')
    LOOP
      IF jsonb_typeof(v_ledger_entry) IS DISTINCT FROM 'object'
         OR COALESCE(v_ledger_entry->>'relation_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){2}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR COALESCE(v_ledger_entry->>'char_a_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){2}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR COALESCE(v_ledger_entry->>'char_b_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){2}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_ledger_entry->'before') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'after') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'change_event') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_ledger_entry->'event_ids') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_ledger_entry->'event_ids') = 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_ledger_entry->'event_ids') AS event(event_id)
           WHERE NULLIF(btrim(event.event_id), '') IS NULL
              OR NOT (event.event_id = ANY(v_selected_event_ids))
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.relation_state AS relation
           WHERE relation.id = (v_ledger_entry->>'relation_state_id')::uuid
             AND relation.book_id = v_book
             AND relation.char_a_id = (v_ledger_entry->>'char_a_id')::uuid
             AND relation.char_b_id = (v_ledger_entry->>'char_b_id')::uuid
             AND relation.is_formal
             AND relation.is_valid
             AND NOT relation.is_shadow
         ) THEN
        RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'Every candidate relation change needs its current formal relation, before/after snapshots, and selected-event evidence.');
      END IF;
    END LOOP;

    FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_candidate_truth_ledger->'memories')
    LOOP
      IF jsonb_typeof(v_ledger_entry) IS DISTINCT FROM 'object'
         OR COALESCE(v_ledger_entry->>'character_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){2}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR COALESCE(v_ledger_entry->>'memory_type', '') NOT IN ('event', 'emotion', 'knowledge', 'relationship')
         OR COALESCE(btrim(v_ledger_entry->>'memory_content'), '') = ''
         OR COALESCE(v_ledger_entry->>'truth_status', '') NOT IN ('true', 'misremembered', 'false')
         OR jsonb_typeof(v_ledger_entry->'importance') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_ledger_entry->'decay_rate') IS DISTINCT FROM 'number'
         OR (v_ledger_entry->>'importance')::numeric NOT BETWEEN 0 AND 1
         OR (v_ledger_entry->>'decay_rate')::numeric NOT BETWEEN 0 AND 1
         OR jsonb_typeof(v_ledger_entry->'event_ids') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_ledger_entry->'event_ids') = 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_ledger_entry->'event_ids') AS event(event_id)
           WHERE NULLIF(btrim(event.event_id), '') IS NULL
              OR NOT (event.event_id = ANY(v_selected_event_ids))
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.character AS character
           WHERE character.id = (v_ledger_entry->>'character_id')::uuid
             AND character.book_id = v_book
             AND character.is_formal
             AND character.is_active
             AND character.is_valid
             AND NOT character.is_shadow
         ) THEN
        RETURN public.v7_error('DEDUCTION_SNAPSHOT_INCOMPLETE', 'Every candidate memory needs a current formal role, retention values, and selected-event evidence.');
      END IF;
    END LOOP;

    IF jsonb_typeof(v_version.deduction_progress_json) = 'object' THEN
      BEGIN
        v_previous_index := COALESCE(NULLIF(v_version.deduction_progress_json->>'current_particle_index', '')::integer, 0);
        v_previous_tokens := COALESCE(NULLIF(v_version.deduction_progress_json->>'token_consumed', '')::bigint, 0);
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN public.v7_error('DEDUCTION_PROGRESS_INCONSISTENT', 'The persisted checkpoint counters are invalid.');
      END;
      IF v_current_index < v_previous_index OR v_token_consumed < v_previous_tokens THEN
        RETURN public.v7_error('CHECKPOINT_REGRESSION', 'A checkpoint cannot move backward in completed particles or consumed tokens.');
      END IF;
      v_previous_input_snapshot := v_version.candidate_plot_sim_json->'deduction_input_snapshot';
      IF jsonb_typeof(v_previous_input_snapshot) = 'object'
         AND v_previous_input_snapshot IS DISTINCT FROM v_deduction_input_snapshot THEN
        RETURN public.v7_error('CHECKPOINT_REGRESSION', 'A checkpoint cannot change its original deduction input.');
      END IF;
      v_previous_records := v_version.candidate_plot_sim_json->'particles_records';
      IF jsonb_typeof(v_previous_records) = 'array' THEN
        v_previous_count := jsonb_array_length(v_previous_records);
        IF v_previous_count > jsonb_array_length(v_records) THEN
          RETURN public.v7_error('CHECKPOINT_REGRESSION', 'A checkpoint cannot remove previously persisted particle facts.');
        END IF;
        IF v_previous_count > 0 THEN
          FOR v_prefix_index IN 0..v_previous_count - 1
          LOOP
            IF v_previous_records->v_prefix_index IS DISTINCT FROM v_records->v_prefix_index THEN
              RETURN public.v7_error('CHECKPOINT_REGRESSION', 'A checkpoint cannot rewrite previously persisted particle facts.');
            END IF;
          END LOOP;
        END IF;
      END IF;
    END IF;

    IF v_version.deduction_locked AND (
      NOT v_complete
      OR v_current_index <> v_previous_index
      OR v_token_consumed <> v_previous_tokens
      OR v_version.candidate_plot_sim_json IS DISTINCT FROM v_plot
    ) THEN
      RETURN public.v7_error('DEDUCTION_ALREADY_LOCKED', 'A completed chapter must remain unchanged while another chapter in the same L1A resumes.');
    END IF;
    v_requested_tokens := v_requested_tokens + v_token_consumed;
    v_all_complete := v_all_complete AND v_complete;
    v_any_budget_exceeded := v_any_budget_exceeded OR v_progress->'token_budget_exceeded' = 'true'::jsonb;
    v_updates := v_updates || jsonb_build_array(jsonb_build_object(
      'chapter_id', v_input_chapter,
      'chapter_version_id', v_input_version,
      'candidate_plot_sim_json', v_plot,
      'deduction_progress_json', v_progress,
      'deduction_complete', v_complete,
      'already_locked', v_version.deduction_locked
    ));
  END LOOP;

  SELECT token_budget INTO v_budget FROM public.book_project WHERE id = v_book;
  IF v_requested_tokens > v_budget THEN
    RETURN public.v7_error('L1A_TOKEN_BUDGET_EXCEEDED', 'This L1A would exceed its fixed 3000000 token budget.');
  END IF;

  PERFORM public.v7_enable_internal_write();
  FOR v_update IN SELECT value FROM jsonb_array_elements(v_updates) AS item(value)
  LOOP
    v_complete := (v_update->>'deduction_complete')::boolean;
    v_status := CASE WHEN v_complete THEN 'deduction_complete' ELSE 'deduction_partial' END;
    v_progress := v_update->'deduction_progress_json' || jsonb_build_object(
      'token_budget', v_budget,
      'token_budget_version', 'mvp-fixed-3000000',
      'l1a_token_consumed', v_requested_tokens,
      'token_budget_exceeded', v_any_budget_exceeded
    );
    IF v_update->'already_locked' IS DISTINCT FROM 'true'::jsonb THEN
      UPDATE public.chapter_version
      SET candidate_plot_sim_json = v_update->'candidate_plot_sim_json',
          deduction_progress_json = v_progress,
          deduction_locked = v_complete
      WHERE id = (v_update->>'chapter_version_id')::uuid;
      UPDATE public.chapter_header
      SET status = v_status,
          run_status = v_status
      WHERE id = (v_update->>'chapter_id')::uuid;
    END IF;
    v_chapter_states := v_chapter_states || jsonb_build_array(jsonb_build_object(
      'chapter_id', (v_update->>'chapter_id')::uuid,
      'chapter_version_id', (v_update->>'chapter_version_id')::uuid,
      'deduction_locked', v_complete
    ));
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('l1a_unit_id', v_l1a, 'chapters', v_chapter_states),
    'state', jsonb_build_object(
      'status', CASE WHEN v_all_complete THEN 'deduction_complete' ELSE 'deduction_partial' END,
      'deduction_locked', v_all_complete,
      'l1a_token_consumed', v_requested_tokens,
      'token_budget', v_budget
    )
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_finalize_deduction_snapshot', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_persist_candidate_text(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_text text := p_request->>'candidate_text';
  v_result jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The candidate text identifiers are invalid.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) OR COALESCE(btrim(v_text), '') = '' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key and non-empty candidate_text are required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_persist_candidate_text', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_persist_candidate_text', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.chapter_header AS h
    JOIN public.chapter_version AS cv ON cv.chapter_id = h.id
    WHERE h.id = v_chapter
      AND h.book_id = v_book
      AND NOT h.is_finalized
      AND h.l1a_unit_id = (SELECT current_l1a_id FROM public.book_project WHERE id = v_book)
      AND cv.id = v_version_id
      AND cv.version_state = 'candidate'
      AND cv.deduction_locked
      AND cv.candidate_plot_sim_json IS NOT NULL
  ) THEN
    RETURN public.v7_error('DEDUCTION_NOT_LOCKED', 'Candidate prose requires a locked deduction snapshot on the current candidate version.');
  END IF;
  PERFORM public.v7_enable_internal_write();
  UPDATE public.chapter_version
  SET prose_text = v_text
  WHERE id = v_version_id;
  UPDATE public.chapter_header
  SET status = 'auditing', run_status = 'auditing'
  WHERE id = v_chapter;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('chapter_id', v_chapter, 'chapter_version_id', v_version_id),
    'state', jsonb_build_object('status', 'auditing')
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_persist_candidate_text', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_confirm_audit_result(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_audit jsonb := p_request->'audit';
  v_package jsonb := v_audit->'audited_handoff_package_jsonb';
  v_asset jsonb;
  v_entry jsonb;
  v_ledger jsonb;
  v_ledger_entry jsonb;
  v_entry_index bigint;
  v_match_count integer;
  v_current_baseline jsonb;
  v_baseline_state_id uuid;
  v_has_p0 boolean;
  v_requires_rewrite boolean;
  v_audit_id uuid;
  v_asset_ids jsonb := '[]'::jsonb;
  v_asset_id uuid;
  v_asset_map jsonb := '{}'::jsonb;
  v_package_asset_refs text[] := ARRAY[]::text[];
  v_request_asset_refs text[] := ARRAY[]::text[];
  v_asset_ref text;
  v_text text;
  v_plot jsonb;
  v_result jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
    v_has_p0 := CASE
      WHEN jsonb_typeof(v_audit->'has_p0_blocker') = 'boolean'
      THEN (v_audit->>'has_p0_blocker')::boolean
      ELSE NULL
    END;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The audit identifiers or has_p0_blocker value are invalid.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key)
     OR jsonb_typeof(v_audit) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_audit->'has_p0_blocker') IS DISTINCT FROM 'boolean'
      OR v_has_p0 IS NULL
      OR jsonb_typeof(v_audit->'audit_findings_jsonb') IS DISTINCT FROM 'object'
      OR v_audit->'audit_findings_jsonb' = '{}'::jsonb
      OR jsonb_typeof(v_audit->'p0_items_json') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_audit->'return_route_suggestion_jsonb') IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_package) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_package->'package_schema_version') IS DISTINCT FROM 'number'
      OR (v_package->>'package_schema_version')::integer <> 1
      OR jsonb_typeof(v_package->'formalization_eligible') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(v_package->'world_changes') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_package->'character_live_state_changes') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_package->'relation_changes') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_package->'memories') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_package->'narrative_assets') IS DISTINCT FROM 'array'
      OR (v_has_p0 AND (
        jsonb_array_length(v_audit->'p0_items_json') = 0
        OR v_audit->'return_route_suggestion_jsonb' = '{}'::jsonb
      ))
      OR (NOT v_has_p0 AND jsonb_array_length(v_audit->'p0_items_json') <> 0) THEN
    RETURN public.v7_error('AUDIT_INCOMPLETE', 'A complete objective audit result is required.');
  END IF;
  v_requires_rewrite := v_has_p0
    OR COALESCE(
      jsonb_typeof(v_audit->'return_route_suggestion_jsonb') = 'object'
      AND v_audit->'return_route_suggestion_jsonb' <> '{}'::jsonb,
      false
    );
  IF (v_package->>'formalization_eligible')::boolean IS DISTINCT FROM (NOT v_requires_rewrite) THEN
    RETURN public.v7_error('AUDIT_HANDOFF_ELIGIBILITY_REJECTED', 'The candidate handoff eligibility must match the objective audit result.');
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'world_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'world_state_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every world handoff change needs a stable ID, before/after baseline, and event evidence.');
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'character_live_state_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'character_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (NULLIF(v_entry->>'baseline_live_state_id', '') IS NOT NULL
           AND v_entry->>'baseline_live_state_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       OR COALESCE(v_entry->>'change_type', '') = ''
       OR jsonb_typeof(v_entry->'change_layer') IS DISTINCT FROM 'number'
       OR (v_entry->>'change_layer')::integer NOT BETWEEN 0 AND 3
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every character handoff change needs a stable ID, baseline, layer, before/after state, and event evidence.');
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'relation_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'relation_state_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_a_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_b_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'change_event') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every relation handoff change needs stable identities, before/after snapshots, and event evidence.');
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'memories')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'character_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'memory_type', '') NOT IN ('event', 'emotion', 'knowledge', 'relationship')
       OR COALESCE(btrim(v_entry->>'memory_content'), '') = ''
       OR COALESCE(v_entry->>'truth_status', '') NOT IN ('true', 'misremembered', 'false')
       OR jsonb_typeof(v_entry->'importance') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_entry->'decay_rate') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every handoff memory needs its stable role, truth status, retention values, and event evidence.');
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'narrative_assets')
  LOOP
    v_asset_ref := btrim(COALESCE(v_entry->>'asset_ref', ''));
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR v_asset_ref = ''
       OR v_asset_ref = ANY(v_package_asset_refs) THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every handoff narrative asset needs one unique asset_ref.');
    END IF;
    v_package_asset_refs := array_append(v_package_asset_refs, v_asset_ref);
  END LOOP;
  v_result := public.v7_replay_product_request(
    'rpc_confirm_audit_result', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_confirm_audit_result', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT cv.prose_text, cv.candidate_plot_sim_json INTO v_text, v_plot
  FROM public.chapter_version AS cv
  JOIN public.chapter_header AS h ON h.id = cv.chapter_id
  WHERE cv.id = v_version_id
    AND cv.chapter_id = v_chapter
    AND cv.book_id = v_book
    AND cv.version_state = 'candidate'
    AND cv.deduction_locked
    AND NOT h.is_finalized
    AND h.l1a_unit_id = (SELECT current_l1a_id FROM public.book_project WHERE id = v_book)
  FOR UPDATE OF cv;
  IF NOT FOUND OR COALESCE(v_text, '') = '' OR v_plot IS NULL THEN
    RETURN public.v7_error('AUDIT_TARGET_REJECTED', 'Objective audit requires the current candidate text and locked deduction snapshot.');
  END IF;

  v_ledger := v_plot->'candidate_truth_ledger';
  IF jsonb_typeof(v_ledger) IS DISTINCT FROM 'object'
     OR NOT (v_ledger ?& ARRAY['schema_version', 'world_changes', 'character_live_state_changes', 'relation_changes', 'memories'])
     OR jsonb_typeof(v_ledger->'schema_version') IS DISTINCT FROM 'number'
     OR (v_ledger->>'schema_version')::integer <> 1
     OR jsonb_typeof(v_ledger->'world_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_ledger->'character_live_state_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_ledger->'relation_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_ledger->'memories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_package->'world_changes') <> jsonb_array_length(v_ledger->'world_changes')
     OR jsonb_array_length(v_package->'character_live_state_changes') <> jsonb_array_length(v_ledger->'character_live_state_changes')
     OR jsonb_array_length(v_package->'relation_changes') <> jsonb_array_length(v_ledger->'relation_changes')
     OR jsonb_array_length(v_package->'memories') <> jsonb_array_length(v_ledger->'memories') THEN
    RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'The audit handoff must cover the complete locked candidate truth ledger.');
  END IF;

  -- FP010-02 accepts only the changes already marked by FP008. The model may
  -- explain them, but it cannot add a second source of candidate truth.
  FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_ledger->'world_changes')
  LOOP
    SELECT count(*) INTO v_match_count
    FROM jsonb_array_elements(v_package->'world_changes') AS package_entry(value)
    WHERE package_entry.value = v_ledger_entry;
    IF v_match_count <> 1 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'The audit world changes must match the locked candidate truth ledger.');
    END IF;
    SELECT atom_value_jsonb INTO v_current_baseline
    FROM public.world_state
    WHERE id = (v_ledger_entry->>'world_state_id')::uuid
      AND book_id = v_book
      AND setting_layer = 'initial'
      AND is_active
      AND is_formal
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_baseline IS DISTINCT FROM v_ledger_entry->'before' THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'The audit world baseline no longer matches the current formal world state.');
    END IF;
  END LOOP;
  FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_ledger->'character_live_state_changes')
  LOOP
    SELECT count(*) INTO v_match_count
    FROM jsonb_array_elements(v_package->'character_live_state_changes') AS package_entry(value)
    WHERE (package_entry.value - 'baseline_live_state_id') = v_ledger_entry;
    IF v_match_count <> 1 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'The audit character changes must match the locked candidate truth ledger.');
    END IF;
    SELECT
      live_state.id,
      CASE WHEN live_state.id IS NULL THEN jsonb_build_object(
        'source', 'initial_live_state_projection',
        'five_layers_json', character.five_layers_json,
        'knowledge_boundary_json', character.knowledge_boundary_json
      ) ELSE jsonb_build_object(
        'philosophy_live_json', live_state.philosophy_live_json,
        'emotion_state_json', live_state.emotion_state_json,
        'drive_live_json', live_state.drive_live_json,
        'trigger_state_json', live_state.trigger_state_json,
        'goal_state_json', live_state.goal_state_json,
        'pressure_level', live_state.pressure_level,
        'current_goal_txt', live_state.current_goal_txt,
        'current_emo_tag', live_state.current_emo_tag
      ) END
    INTO v_baseline_state_id, v_current_baseline
    FROM public.character AS character
    LEFT JOIN public.character_live_state AS live_state
      ON live_state.character_id = character.id
     AND live_state.is_formal
     AND live_state.is_valid
     AND NOT live_state.is_shadow
    WHERE character.id = (v_ledger_entry->>'character_id')::uuid
      AND character.book_id = v_book
      AND character.is_formal
      AND character.is_active
      AND character.is_valid
      AND NOT character.is_shadow;
    IF NOT FOUND OR v_current_baseline IS DISTINCT FROM v_ledger_entry->'before' THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'The audit character baseline no longer matches the current formal state projection.');
    END IF;
    FOR v_entry, v_entry_index IN
      SELECT value, ordinal_position
      FROM jsonb_array_elements(v_package->'character_live_state_changes') WITH ORDINALITY AS package_entry(value, ordinal_position)
      WHERE (value - 'baseline_live_state_id') = v_ledger_entry
    LOOP
      v_package := jsonb_set(
        v_package,
        ARRAY['character_live_state_changes', (v_entry_index - 1)::text, 'baseline_live_state_id'],
        COALESCE(to_jsonb(v_baseline_state_id::text), 'null'::jsonb),
        true
      );
    END LOOP;
  END LOOP;
  FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_ledger->'relation_changes')
  LOOP
    SELECT count(*) INTO v_match_count
    FROM jsonb_array_elements(v_package->'relation_changes') AS package_entry(value)
    WHERE package_entry.value = v_ledger_entry;
    IF v_match_count <> 1 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'The audit relation changes must match the locked candidate truth ledger.');
    END IF;
    SELECT jsonb_build_object(
      'trust', relation.trust,
      'intimacy', relation.intimacy,
      'power_balance', relation.power_balance,
      'dependence', relation.dependence,
      'hostility', relation.hostility,
      'common_goal', relation.common_goal,
      'secret_known', relation.secret_known,
      'emotional_bond', relation.emotional_bond,
      'relation_type', relation.relation_type,
      'relation_hierarchy', relation.relation_hierarchy,
      'relation_origin', relation.relation_origin,
      'relation_overview', relation.relation_overview,
      'change_event_json', relation.change_event_json
    ) INTO v_current_baseline
    FROM public.relation_state AS relation
    WHERE relation.id = (v_ledger_entry->>'relation_state_id')::uuid
      AND relation.book_id = v_book
      AND relation.char_a_id = (v_ledger_entry->>'char_a_id')::uuid
      AND relation.char_b_id = (v_ledger_entry->>'char_b_id')::uuid
      AND relation.is_formal
      AND relation.is_valid
      AND NOT relation.is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_baseline IS DISTINCT FROM v_ledger_entry->'before' THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'The audit relation baseline no longer matches the current formal relation state.');
    END IF;
  END LOOP;
  FOR v_ledger_entry IN SELECT value FROM jsonb_array_elements(v_ledger->'memories')
  LOOP
    SELECT count(*) INTO v_match_count
    FROM jsonb_array_elements(v_package->'memories') AS package_entry(value)
    WHERE package_entry.value = v_ledger_entry;
    IF v_match_count <> 1 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'The audit memories must match the locked candidate truth ledger.');
    END IF;
  END LOOP;

  IF jsonb_typeof(COALESCE(p_request->'assets', '[]'::jsonb)) <> 'array' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'assets must be an array.');
  END IF;
  FOR v_asset IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'assets', '[]'::jsonb))
  LOOP
    v_asset_ref := btrim(COALESCE(v_asset->>'asset_ref', ''));
    IF v_asset_ref = ''
       OR v_asset_ref = ANY(v_request_asset_refs)
       OR NOT (v_asset_ref = ANY(v_package_asset_refs))
       OR COALESCE(v_asset->>'asset_type', '') = ''
       OR COALESCE(v_asset->>'asset_name', '') = ''
       OR COALESCE(v_asset->>'asset_description', '') = '' THEN
      RETURN public.v7_error('ASSET_INCOMPLETE', 'Every identified narrative asset needs one matching handoff ref, type, name, and description.');
    END IF;
    v_request_asset_refs := array_append(v_request_asset_refs, v_asset_ref);
  END LOOP;
  IF cardinality(v_request_asset_refs) <> cardinality(v_package_asset_refs) THEN
    RETURN public.v7_error('ASSET_HANDOFF_MISMATCH', 'The candidate handoff and objective asset list must name the same assets.');
  END IF;

  PERFORM public.v7_enable_internal_write();
  v_audit_id := gen_random_uuid();
  FOR v_asset IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'assets', '[]'::jsonb))
  LOOP
    INSERT INTO public.narrative_asset(
      book_id, linked_chapter_id, chapter_version_id, asset_type, asset_name,
      asset_description, hook_category, countdown_deadline, fulfillment_window,
      status, is_formal, is_shadow, is_valid, credibility_level, evidence_json,
      value_anchor, current_effect_json
    ) VALUES (
      v_book, v_chapter, v_version_id, v_asset->>'asset_type', v_asset->>'asset_name',
      v_asset->>'asset_description', v_asset->>'hook_category',
      NULLIF(v_asset->>'countdown_deadline', '')::integer, v_asset->>'fulfillment_window',
      COALESCE(v_asset->>'status', 'planted'), false, false, true,
      v_asset->>'credibility_level', v_asset->'evidence_json', v_asset->'value_anchor',
      v_asset->'current_effect_json'
    ) RETURNING id INTO v_asset_id;
    v_asset_map := v_asset_map || jsonb_build_object(v_asset->>'asset_ref', v_asset_id::text);
    v_asset_ids := v_asset_ids || jsonb_build_array(v_asset_id);
  END LOOP;

  v_package := jsonb_set(v_package, '{audit_attempt_id}', to_jsonb(v_audit_id::text), true);
  v_package := jsonb_set(v_package, '{chapter_version_id}', to_jsonb(v_version_id::text), true);
  v_package := jsonb_set(
    v_package,
    '{narrative_assets}',
    COALESCE((
      SELECT jsonb_agg(
        entry.value || jsonb_build_object('candidate_asset_id', v_asset_map -> (entry.value->>'asset_ref'))
      )
      FROM jsonb_array_elements(v_package->'narrative_assets') AS entry(value)
    ), '[]'::jsonb),
    true
  );
  INSERT INTO public.audit_attempt_log(
    id, book_id, chapter_id, chapter_version_id, audit_type, candidate_text_snapshot,
    has_p0_blocker, p0_items_json, audit_findings_jsonb,
    return_route_suggestion_jsonb, frozen_deduction_result_jsonb, audited_handoff_package_jsonb,
    audit_object_type, audit_object_id, audit_status, is_shadow, is_valid
  ) VALUES (
    v_audit_id, v_book, v_chapter, v_version_id, 'objective',
    v_text, v_has_p0, v_audit->'p0_items_json', v_audit->'audit_findings_jsonb',
    v_audit->'return_route_suggestion_jsonb', v_plot, v_package, v_audit->>'audit_object_type',
    NULLIF(v_audit->>'audit_object_id', '')::uuid, 'completed', false, true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('audit_id', v_audit_id, 'asset_ids', v_asset_ids),
    'state', jsonb_build_object('has_p0_blocker', v_has_p0)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_confirm_audit_result', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_record_chapter_review_evidence(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_phase text := p_request->>'phase';
  v_decision jsonb := p_request->'decision_json';
  v_score jsonb := p_request->'score_json';
  v_creator_confirmed boolean;
  v_log_id uuid;
  v_result jsonb;
  v_has_p0 boolean;
  v_audit_text text;
  v_return_route jsonb;
  v_audit_created_at timestamptz;
  v_candidate_text text;
  v_progress jsonb;
  v_reject_count integer;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
    v_creator_confirmed := false;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The review identifiers are invalid.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key)
     OR COALESCE(v_phase, '') NOT IN ('reader', 'commercial', 'editorial') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'phase must be reader, commercial, or editorial and an idempotency_key is required.');
  END IF;
  IF COALESCE(p_request->'creator_confirmed', 'false'::jsonb) IS DISTINCT FROM 'false'::jsonb THEN
    RETURN public.v7_error('REVIEW_INCOMPLETE', 'Internal review evidence cannot record creator confirmation.');
  END IF;
  IF (v_phase IN ('reader', 'commercial') AND (
       jsonb_typeof(v_score) IS DISTINCT FROM 'object' OR v_score = '{}'::jsonb
     ))
     OR (v_phase = 'editorial' AND jsonb_typeof(v_decision) IS DISTINCT FROM 'object') THEN
    RETURN public.v7_error('REVIEW_INCOMPLETE', 'Reader/commercial evidence needs score_json and editorial evidence needs decision_json.');
  END IF;
  IF v_phase IN ('reader', 'commercial') AND EXISTS (
    SELECT 1
    FROM jsonb_each(v_score) AS dimension(key, value)
    WHERE (
        jsonb_typeof(dimension.value) = 'number'
        AND (dimension.value #>> '{}')::numeric <> 0
      )
      OR (
        jsonb_typeof(dimension.value) = 'object'
        AND (
        (
          jsonb_typeof(dimension.value->'score') = 'number'
          AND (dimension.value->>'score')::numeric <> 0
        )
        OR (
          jsonb_typeof(dimension.value->'得分') = 'number'
          AND (dimension.value->>'得分')::numeric <> 0
        )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_each_text(dimension.value) AS evidence(key, value)
          WHERE evidence.key IN ('evidence', '原文依据', '镜头履约情况')
            AND NULLIF(btrim(evidence.value), '') IS NOT NULL
        )
      )
  ) THEN
    RETURN public.v7_error('REVIEW_INCOMPLETE', 'Every non-zero review dimension needs non-empty evidence.');
  END IF;
  IF v_phase = 'editorial'
     AND (COALESCE(v_decision->>'verdict', '') NOT IN ('Y', 'N')
          OR jsonb_typeof(v_decision->'force_manual') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(v_decision->'reject_count_observed') IS DISTINCT FROM 'number'
          OR COALESCE(v_decision->>'reject_count_observed', '') NOT IN ('0', '1', '2')
          OR v_decision->'force_manual' IS DISTINCT FROM to_jsonb(
            (v_decision->>'verdict') = 'N'
            AND (v_decision->>'reject_count_observed') = '2'
          )
          OR ((v_decision->>'verdict') = 'N' AND (
            jsonb_typeof(p_request->'fix_instruction_json') IS DISTINCT FROM 'object'
            OR p_request->'fix_instruction_json' = '{}'::jsonb
          ))) THEN
    RETURN public.v7_error('EDITORIAL_DECISION_INCOMPLETE', 'Editorial evidence needs the V7 verdict/return-count/force-manual tuple and fix instructions for N.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_record_chapter_review_evidence', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_record_chapter_review_evidence', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT cv.prose_text, cv.deduction_progress_json INTO v_candidate_text, v_progress
  FROM public.chapter_version AS cv
  JOIN public.chapter_header AS h ON h.id = cv.chapter_id
  WHERE cv.id = v_version_id
    AND cv.chapter_id = v_chapter
    AND cv.book_id = v_book
    AND cv.version_state = 'candidate'
    AND NOT h.is_finalized
    AND h.l1a_unit_id = (SELECT current_l1a_id FROM public.book_project WHERE id = v_book)
  FOR UPDATE OF cv;
  IF NOT FOUND OR COALESCE(v_candidate_text, '') = '' THEN
    RETURN public.v7_error('VERSION_REJECTED', 'Review evidence must target a current-L1A candidate version with prose.');
  END IF;
  IF v_phase IN ('reader', 'commercial', 'editorial') THEN
    SELECT has_p0_blocker, candidate_text_snapshot, return_route_suggestion_jsonb, created_at
      INTO v_has_p0, v_audit_text, v_return_route, v_audit_created_at
    FROM public.audit_attempt_log
    WHERE chapter_version_id = v_version_id
      AND audit_type = 'objective'
      AND audit_status = 'completed'
      AND is_valid AND NOT is_shadow
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    IF NOT FOUND OR v_audit_text IS DISTINCT FROM v_candidate_text THEN
      RETURN public.v7_error('AUDIT_STALE', 'Review evidence requires the latest objective audit to match the current candidate prose exactly.');
    END IF;
    IF COALESCE(v_has_p0, true) THEN
      RETURN public.v7_error('P0_BLOCKED', 'A current P0 blocker must return to FP009 before any subjective or editorial review.');
    END IF;
    IF jsonb_typeof(v_return_route) = 'object' AND v_return_route <> '{}'::jsonb THEN
      RETURN public.v7_error('OBJECTIVE_RETURN_BLOCKED', 'Objective audit must return this candidate to FP009 before any subjective or editorial review.');
    END IF;
  END IF;
  IF v_phase = 'editorial' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.editor_log
      WHERE book_id = v_book
        AND chapter_id = v_chapter
        AND chapter_version_id = v_version_id
        AND phase = 'reader'
        AND jsonb_typeof(score_json) = 'object'
        AND score_json <> '{}'::jsonb
        AND is_valid AND NOT is_shadow
        AND created_at >= v_audit_created_at
    ) OR NOT EXISTS (
      SELECT 1 FROM public.editor_log
      WHERE book_id = v_book
        AND chapter_id = v_chapter
        AND chapter_version_id = v_version_id
        AND phase = 'commercial'
        AND jsonb_typeof(score_json) = 'object'
        AND score_json <> '{}'::jsonb
        AND is_valid AND NOT is_shadow
        AND created_at >= v_audit_created_at
    ) THEN
      RETURN public.v7_error('REVIEW_EVIDENCE_INCOMPLETE', 'Editorial review requires objective, reader, and commercial evidence for the same candidate version.');
    END IF;
    BEGIN
      v_reject_count := COALESCE(NULLIF(v_progress->>'reject_count', '')::integer, 0);
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('DEDUCTION_PROGRESS_INCONSISTENT', 'The persisted reject_count is invalid.');
    END;
    IF (v_decision->>'reject_count_observed')::integer <> v_reject_count THEN
      RETURN public.v7_error('REVIEW_STATE_STALE', 'The editorial decision used a stale return count; refresh the current candidate before deciding.');
    END IF;
    v_decision := v_decision || jsonb_build_object('reject_count_observed', v_reject_count);
  END IF;

  PERFORM public.v7_enable_internal_write();
  IF v_phase = 'editorial' AND v_decision->>'verdict' = 'N' THEN
    UPDATE public.chapter_version
    SET deduction_progress_json = jsonb_set(
      COALESCE(deduction_progress_json, '{}'::jsonb),
      '{reject_count}',
      to_jsonb(v_reject_count + 1),
      true
    )
    WHERE id = v_version_id;
  END IF;
  INSERT INTO public.editor_log(
    book_id, chapter_id, chapter_version_id, phase, decision_json, score_json,
    exemption_reason_json, creator_confirmed, confirmation_deadline,
    fix_instruction_json, review_comment, is_shadow, is_valid
  ) VALUES (
    v_book, v_chapter, v_version_id, v_phase, v_decision, v_score,
    p_request->'exemption_reason_json', v_creator_confirmed,
    NULLIF(p_request->>'confirmation_deadline', '')::timestamptz,
    p_request->'fix_instruction_json', p_request->>'review_comment', false, true
  ) RETURNING id INTO v_log_id;
  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('editor_log_id', v_log_id),
    'state', jsonb_build_object('phase', v_phase, 'creator_confirmed', v_creator_confirmed)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_record_chapter_review_evidence', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_continue_chapter(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_result jsonb;
  v_next_chapter uuid;
  v_next_version uuid;
  v_next_index integer;
  v_l1a_unit uuid;
  v_current_l1a_unit uuid;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The continuation identifiers are invalid.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_continue_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_continue_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.chapter_header AS h
    JOIN public.chapter_version AS cv
      ON cv.id = v_version_id
     AND cv.chapter_id = h.id
     AND cv.book_id = h.book_id
     AND cv.version_state = 'formal'
     AND cv.is_formal
     AND cv.is_valid
     AND NOT cv.is_shadow
    JOIN public.book_project AS bp
      ON bp.id = h.book_id
     AND bp.current_l1a_id = h.l1a_unit_id
    WHERE h.id = v_chapter
      AND h.book_id = v_book
      AND h.is_finalized
      AND h.confirmation_status = 'unconfirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.chapter_header AS later
        JOIN public.chapter_version AS later_version
          ON later_version.chapter_id = later.id
         AND later_version.book_id = later.book_id
         AND later_version.version_state = 'formal'
         AND later_version.is_formal
         AND later_version.is_valid
         AND NOT later_version.is_shadow
        WHERE later.book_id = h.book_id
          AND later.l1a_unit_id = h.l1a_unit_id
          AND later.chapter_index > h.chapter_index
      )
      AND EXISTS (
        SELECT 1
        FROM public.audit_attempt_log AS audit
        WHERE audit.book_id = h.book_id
          AND audit.chapter_id = h.id
          AND audit.chapter_version_id = cv.id
          AND audit.audit_type = 'objective'
          AND audit.audit_status = 'completed'
          AND NOT audit.has_p0_blocker
          AND (jsonb_typeof(audit.return_route_suggestion_jsonb) IS DISTINCT FROM 'object'
               OR audit.return_route_suggestion_jsonb = '{}'::jsonb)
          AND audit.is_valid
          AND NOT audit.is_shadow
      )
      AND EXISTS (
        SELECT 1
        FROM public.editor_log AS editor
        WHERE editor.book_id = h.book_id
          AND editor.chapter_id = h.id
          AND editor.chapter_version_id = cv.id
          AND editor.phase = 'editorial'
          AND editor.decision_json->>'verdict' = 'Y'
          AND COALESCE((editor.decision_json->>'force_manual')::boolean, true) IS FALSE
          AND editor.is_valid
          AND NOT editor.is_shadow
      )
  ) THEN
    RETURN public.v7_error('CONTINUATION_REJECTED', 'Only the current L1A latest formal chapter with passing objective and editorial evidence can continue.');
  END IF;

  PERFORM public.v7_enable_internal_write();
  UPDATE public.chapter_header
  SET status = 'confirmed', run_status = 'continued', confirmation_status = 'creator_confirmed'
  WHERE id = v_chapter AND book_id = v_book;

  SELECT l1a_unit_id INTO v_current_l1a_unit
  FROM public.chapter_header
  WHERE id = v_chapter AND book_id = v_book;

  SELECT h.id, cv.id, h.chapter_index, h.l1a_unit_id
    INTO v_next_chapter, v_next_version, v_next_index, v_l1a_unit
  FROM public.chapter_header AS h
  JOIN public.book_project AS bp
    ON bp.id = h.book_id
   AND bp.current_l1a_id = h.l1a_unit_id
  JOIN public.chapter_version AS cv
    ON cv.chapter_id = h.id
   AND cv.book_id = h.book_id
   AND cv.version_state = 'candidate'
   AND cv.deduction_locked
   AND cv.is_valid
   AND NOT cv.is_shadow
  WHERE h.book_id = v_book
    AND h.chapter_index > (
      SELECT chapter_index FROM public.chapter_header WHERE id = v_chapter AND book_id = v_book
    )
    AND NOT h.is_finalized
  ORDER BY h.chapter_index
  LIMIT 1
  FOR UPDATE OF h, cv;

  IF v_next_chapter IS NULL THEN
    UPDATE public.l1a_unit
    SET status = 'completed'
    WHERE id = v_current_l1a_unit
      AND book_id = v_book
      AND status = 'locked_for_deduction'
      AND is_formal
      AND is_valid
      AND NOT is_shadow;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object('chapter_id', v_chapter, 'chapter_version_id', v_version_id),
    'state', jsonb_build_object(
      'action', 'continue_next_chapter',
      'next_action', CASE WHEN v_next_chapter IS NULL THEN 'l1a_complete' ELSE 'present_next_chapter' END,
      'next_chapter_index', v_next_index
    ),
    'next_presentation_request', CASE WHEN v_next_chapter IS NULL THEN NULL ELSE jsonb_build_object(
      'local_operator_id', v_operator,
      'book_id', v_book,
      'l1a_unit_id', v_l1a_unit,
      'chapter_id', v_next_chapter,
      'chapter_version_id', v_next_version,
      'idempotency_key', v_key || ':next'
    ) END
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_continue_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_archive_shadow_version(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_return_reason text := btrim(COALESCE(p_request->>'return_reason', ''));
  v_result jsonb;
  v_header public.chapter_header%ROWTYPE;
  v_version public.chapter_version%ROWTYPE;
  v_writeback public.writeback_log%ROWTYPE;
  v_audit public.audit_attempt_log%ROWTYPE;
  v_scope jsonb;
  v_header_before jsonb;
  v_entry jsonb;
  v_world_id uuid;
  v_char_id uuid;
  v_relation_id uuid;
  v_new_state_id uuid;
  v_baseline_state_id uuid;
  v_memory_id uuid;
  v_asset_id uuid;
  v_audit_id uuid;
  v_editorial_id uuid;
  v_current_world jsonb;
  v_current_relation jsonb;
  v_state public.character_live_state%ROWTYPE;
  v_baseline_state public.character_live_state%ROWTYPE;
  v_state_json jsonb;
  v_world_ids uuid[] := ARRAY[]::uuid[];
  v_char_ids uuid[] := ARRAY[]::uuid[];
  v_relation_ids uuid[] := ARRAY[]::uuid[];
  v_memory_ids uuid[] := ARRAY[]::uuid[];
  v_asset_ids uuid[] := ARRAY[]::uuid[];
  v_successor_version_id uuid := gen_random_uuid();
  v_successor_version_no integer;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The formal rollback identifiers are invalid.');
  END;
  IF v_chapter IS NULL OR v_version_id IS NULL THEN
    RETURN public.v7_error('INVALID_REQUEST', 'chapter_id and chapter_version_id are required.');
  END IF;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_archive_shadow_version', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_archive_shadow_version', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT h.* INTO v_header
  FROM public.chapter_header AS h
  JOIN public.book_project AS bp
    ON bp.id = h.book_id
   AND bp.current_l1a_id = h.l1a_unit_id
  WHERE h.id = v_chapter
    AND h.book_id = v_book
    AND h.is_finalized
    AND h.confirmation_status = 'unconfirmed'
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN public.v7_error('FORMAL_RETURN_REJECTED', 'Only the current unconfirmed formal chapter can be returned.');
  END IF;
  SELECT * INTO v_version
  FROM public.chapter_version
  WHERE id = v_version_id
    AND chapter_id = v_chapter
    AND book_id = v_book
    AND version_state = 'formal'
    AND is_formal
    AND is_valid
    AND NOT is_shadow
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('FORMAL_RETURN_REJECTED', 'Only a current formal chapter version can be returned.');
  END IF;
  IF v_return_reason = '' THEN
    RETURN public.v7_error('RETURN_REASON_REQUIRED', 'Returning the current formal chapter requires a reason.');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.chapter_header AS later
    JOIN public.chapter_version AS later_version
      ON later_version.chapter_id = later.id
     AND later_version.book_id = later.book_id
     AND later_version.is_valid
     AND NOT later_version.is_shadow
    WHERE later.book_id = v_book
      AND later.l1a_unit_id = v_header.l1a_unit_id
      AND later.chapter_index > v_header.chapter_index
      AND (
        later_version.version_state = 'formal'
        OR NULLIF(btrim(later_version.prose_text), '') IS NOT NULL
      )
  ) THEN
    RETURN public.v7_error('FORMAL_RETURN_REJECTED', 'The next chapter has already started literary presentation, so this formal chapter cannot be returned.');
  END IF;
  SELECT * INTO v_writeback
  FROM public.writeback_log
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id
    AND status = 'success'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The current formal chapter has no success writeback ledger to reverse.');
  END IF;
  v_scope := v_writeback.writeback_scope_jsonb;
  v_header_before := v_scope->'chapter_header_before';
  IF jsonb_typeof(v_scope) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_header_before) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_header_before->'status') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_header_before->'run_status') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_header_before->'is_finalized') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_header_before->'confirmation_status') IS DISTINCT FROM 'string'
     OR COALESCE(v_header_before->>'word_count', '') !~ '^[0-9]+$'
     OR jsonb_typeof(v_scope->'memory_ids') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_writeback.world_diff_json) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_writeback.char_diff_json) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_writeback.relation_diff_json) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_writeback.asset_diff_json) IS DISTINCT FROM 'array' THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The formal writeback ledger does not contain a complete reversible scope.');
  END IF;
  BEGIN
    v_audit_id := NULLIF(v_scope->>'audit_attempt_id', '')::uuid;
    v_editorial_id := NULLIF(v_scope->>'editorial_log_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The formal writeback ledger contains invalid evidence identifiers.');
  END;
  IF v_audit_id IS NULL OR v_editorial_id IS NULL THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The formal writeback ledger is missing its objective or editorial evidence link.');
  END IF;
  SELECT * INTO v_audit
  FROM public.audit_attempt_log
  WHERE id = v_audit_id
    AND book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id
    AND audit_type = 'objective'
    AND audit_status = 'completed'
    AND is_valid
    AND NOT is_shadow
  FOR UPDATE;
  IF NOT FOUND OR v_audit.has_p0_blocker THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The formal writeback ledger is not linked to a current passing objective audit.');
  END IF;
  PERFORM 1
  FROM public.editor_log
  WHERE id = v_editorial_id
    AND book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id
    AND phase = 'editorial'
    AND decision_json->>'verdict' = 'Y'
    AND is_valid
    AND NOT is_shadow
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'The formal writeback ledger is not linked to its chief-editor approval.');
  END IF;

  -- Validate and lock every reversible row before the first write.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.world_diff_json)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'world_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A world writeback entry is not reversible.');
    END IF;
    v_world_id := (v_entry->>'world_state_id')::uuid;
    IF v_world_id = ANY(v_world_ids) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A world state appears more than once in one writeback ledger.');
    END IF;
    SELECT atom_value_jsonb INTO v_current_world
    FROM public.world_state
    WHERE id = v_world_id
      AND book_id = v_book
      AND setting_layer = 'initial'
      AND is_active
      AND is_formal
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_world IS DISTINCT FROM v_entry->'after' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A formal world value changed after this chapter and cannot be safely returned.');
    END IF;
    v_world_ids := array_append(v_world_ids, v_world_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.char_diff_json)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'character_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'new_live_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR (NULLIF(v_entry->>'baseline_live_state_id', '') IS NOT NULL
           AND v_entry->>'baseline_live_state_id' !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A character writeback entry is not reversible.');
    END IF;
    v_char_id := (v_entry->>'character_id')::uuid;
    v_new_state_id := (v_entry->>'new_live_state_id')::uuid;
    v_baseline_state_id := NULLIF(v_entry->>'baseline_live_state_id', '')::uuid;
    IF v_char_id = ANY(v_char_ids) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A character appears more than once in one writeback ledger.');
    END IF;
    SELECT * INTO v_state
    FROM public.character_live_state
    WHERE id = v_new_state_id
      AND book_id = v_book
      AND character_id = v_char_id
      AND chapter_id = v_chapter
      AND chapter_version_id = v_version_id
      AND is_formal
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A current formal character state no longer matches this chapter writeback.');
    END IF;
    v_state_json := jsonb_build_object(
      'philosophy_live_json', v_state.philosophy_live_json,
      'emotion_state_json', v_state.emotion_state_json,
      'drive_live_json', v_state.drive_live_json,
      'trigger_state_json', v_state.trigger_state_json,
      'goal_state_json', v_state.goal_state_json,
      'pressure_level', v_state.pressure_level,
      'current_goal_txt', v_state.current_goal_txt,
      'current_emo_tag', v_state.current_emo_tag
    );
    IF v_state_json IS DISTINCT FROM v_entry->'after'
       OR v_state.predecessor_state_id IS DISTINCT FROM v_baseline_state_id THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A current formal character state changed after this chapter and cannot be safely returned.');
    END IF;
    IF v_baseline_state_id IS NOT NULL THEN
      SELECT * INTO v_baseline_state
      FROM public.character_live_state
      WHERE id = v_baseline_state_id
        AND book_id = v_book
        AND character_id = v_char_id
        AND is_valid
        AND NOT is_shadow
        AND NOT is_formal
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'The prior formal character state is unavailable for restoration.');
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.character_writeback_log
      WHERE writeback_log_id = v_writeback.id
        AND char_id = v_char_id
        AND chapter_id = v_chapter
        AND chapter_version_id = v_version_id
        AND is_valid
        AND NOT is_shadow
      FOR UPDATE
    ) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A character state has no matching writeback log.');
    END IF;
    v_char_ids := array_append(v_char_ids, v_char_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.relation_diff_json)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'relation_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_a_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_b_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A relation writeback entry is not reversible.');
    END IF;
    v_relation_id := (v_entry->>'relation_state_id')::uuid;
    IF v_relation_id = ANY(v_relation_ids) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A relation appears more than once in one writeback ledger.');
    END IF;
    SELECT jsonb_build_object(
      'trust', trust, 'intimacy', intimacy, 'power_balance', power_balance,
      'dependence', dependence, 'hostility', hostility, 'common_goal', common_goal,
      'secret_known', secret_known, 'emotional_bond', emotional_bond,
      'relation_type', relation_type, 'relation_hierarchy', relation_hierarchy,
      'relation_origin', relation_origin, 'relation_overview', relation_overview,
      'change_event_json', change_event_json
    ) INTO v_current_relation
    FROM public.relation_state
    WHERE id = v_relation_id
      AND book_id = v_book
      AND char_a_id = (v_entry->>'char_a_id')::uuid
      AND char_b_id = (v_entry->>'char_b_id')::uuid
      AND is_formal
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_relation IS DISTINCT FROM v_entry->'after' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A formal relation changed after this chapter and cannot be safely returned.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.relation_state_log
      WHERE book_id = v_book
        AND chapter_id = v_chapter
        AND chapter_version_id = v_version_id
        AND relation_state_id = v_relation_id
        AND is_valid
        AND NOT is_shadow
      FOR UPDATE
    ) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A relation state has no matching change snapshot.');
    END IF;
    v_relation_ids := array_append(v_relation_ids, v_relation_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_scope->'memory_ids')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'string'
       OR v_entry #>> '{}' !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A memory identifier in the writeback ledger is invalid.');
    END IF;
    v_memory_id := (v_entry #>> '{}')::uuid;
    IF v_memory_id = ANY(v_memory_ids) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'A memory appears more than once in one writeback ledger.');
    END IF;
    PERFORM 1 FROM public.character_memory
    WHERE id = v_memory_id
      AND book_id = v_book
      AND chapter_id = v_chapter
      AND chapter_version_id = v_version_id
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A chapter memory is unavailable for formal return.');
    END IF;
    v_memory_ids := array_append(v_memory_ids, v_memory_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.asset_diff_json)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'asset_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'An asset writeback entry is not reversible.');
    END IF;
    v_asset_id := (v_entry->>'asset_id')::uuid;
    IF v_asset_id = ANY(v_asset_ids) THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_LEDGER_INCOMPLETE', 'An asset appears more than once in one writeback ledger.');
    END IF;
    PERFORM 1 FROM public.narrative_asset
    WHERE id = v_asset_id
      AND book_id = v_book
      AND linked_chapter_id = v_chapter
      AND chapter_version_id = v_version_id
      AND is_formal
      AND is_valid
      AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('FORMAL_ROLLBACK_BASELINE_STALE', 'A formal narrative asset is unavailable for return.');
    END IF;
    v_asset_ids := array_append(v_asset_ids, v_asset_id);
  END LOOP;

  PERFORM public.v7_enable_internal_write();
  PERFORM set_config('v7.formal_rollback', 'on', true);
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.world_diff_json)
  LOOP
    UPDATE public.world_state
    SET atom_value_jsonb = v_entry->'before'
    WHERE id = (v_entry->>'world_state_id')::uuid;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.char_diff_json)
  LOOP
    v_new_state_id := (v_entry->>'new_live_state_id')::uuid;
    v_baseline_state_id := NULLIF(v_entry->>'baseline_live_state_id', '')::uuid;
    UPDATE public.character_live_state
    SET is_formal = false, is_shadow = true, is_valid = false
    WHERE id = v_new_state_id;
    IF v_baseline_state_id IS NOT NULL THEN
      UPDATE public.character_live_state
      SET is_formal = true, is_shadow = false, is_valid = true
      WHERE id = v_baseline_state_id;
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_writeback.relation_diff_json)
  LOOP
    UPDATE public.relation_state
    SET trust = (v_entry->'before'->>'trust')::integer,
        intimacy = (v_entry->'before'->>'intimacy')::integer,
        power_balance = (v_entry->'before'->>'power_balance')::integer,
        dependence = (v_entry->'before'->>'dependence')::integer,
        hostility = (v_entry->'before'->>'hostility')::integer,
        common_goal = (v_entry->'before'->>'common_goal')::integer,
        secret_known = (v_entry->'before'->>'secret_known')::integer,
        emotional_bond = (v_entry->'before'->>'emotional_bond')::integer,
        relation_type = v_entry->'before'->>'relation_type',
        relation_hierarchy = v_entry->'before'->>'relation_hierarchy',
        relation_origin = v_entry->'before'->>'relation_origin',
        relation_overview = v_entry->'before'->>'relation_overview',
        change_event_json = v_entry->'before'->'change_event_json'
    WHERE id = (v_entry->>'relation_state_id')::uuid;
  END LOOP;
  UPDATE public.character_writeback_log
  SET is_shadow = true, is_valid = false
  WHERE writeback_log_id = v_writeback.id;
  UPDATE public.relation_state_log
  SET is_shadow = true, is_valid = false
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id;
  UPDATE public.character_memory
  SET is_shadow = true, is_valid = false
  WHERE id = ANY(v_memory_ids);
  UPDATE public.narrative_asset
  SET is_formal = false, is_shadow = true, is_valid = false
  WHERE id = ANY(v_asset_ids);
  UPDATE public.vector_index_log
  SET is_shadow = true, is_valid = false, invalidated_at = clock_timestamp()
  WHERE book_id = v_book
    AND (
      (source_table = 'character_memory' AND source_id = ANY(v_memory_ids))
      OR (
        source_table = 'relation_state_log'
        AND source_id IN (
          SELECT id FROM public.relation_state_log
          WHERE book_id = v_book
            AND chapter_id = v_chapter
            AND chapter_version_id = v_version_id
        )
      )
    );
  UPDATE public.retrieval_snapshot
  SET is_shadow = true, is_valid = false
  WHERE chapter_id = v_chapter AND chapter_version_id = v_version_id;
  UPDATE public.editor_log
  SET review_comment = v_return_reason
  WHERE id = v_editorial_id;
  UPDATE public.audit_attempt_log
  SET is_shadow = true, is_valid = false
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id;
  UPDATE public.editor_log
  SET is_shadow = true, is_valid = false
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id;
  UPDATE public.writeback_log
  SET status = 'rolled_back', rollback_reason = v_return_reason
  WHERE id = v_writeback.id;
  UPDATE public.chapter_version
  SET version_state = 'shadow', is_shadow = true, is_formal = false, is_valid = false,
      review_decision = 'returned', review_comment = v_return_reason
  WHERE id = v_version_id;
  UPDATE public.chapter_header
  SET status = v_header_before->>'status',
      run_status = v_header_before->>'run_status',
      is_finalized = (v_header_before->>'is_finalized')::boolean,
      confirmation_status = v_header_before->>'confirmation_status',
      word_count = (v_header_before->>'word_count')::integer
  WHERE id = v_chapter;
  v_successor_version_no := v_version.version_no + 1;
  INSERT INTO public.chapter_version(
    id, book_id, chapter_id, version_no, predecessor_version_id,
    version_state, is_shadow, is_formal, is_valid,
    target_snapshot_json, chapter_implementation_json, candidate_plot_sim_json,
    deduction_progress_json, deduction_locked, exception_summary_jsonb
  ) VALUES (
    v_successor_version_id, v_book, v_chapter, v_successor_version_no, v_version_id,
    'candidate', false, false, true,
    v_version.target_snapshot_json, v_version.chapter_implementation_json,
    COALESCE(v_version.formal_plot_sim_json, v_version.candidate_plot_sim_json),
    v_version.deduction_progress_json, v_version.deduction_locked, v_version.exception_summary_jsonb
  );
  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object(
      'chapter_id', v_chapter,
      'archived_chapter_version_id', v_version_id,
      'successor_chapter_version_id', v_successor_version_id,
      'writeback_log_id', v_writeback.id
    ),
    'state', jsonb_build_object(
      'version_state', 'candidate',
      'next_action', 'present_rewrite_candidate'
    )
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_archive_shadow_version', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_enhance_prose(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  RETURN public.v7_error('CHANGE_LIMIT_CONTRACT_UNRESOLVED', 'V7 requires the server to calculate and enforce a prose change limit, but does not define its calculation or threshold. No enhanced prose is accepted.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_commit_chapter(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_chapter uuid;
  v_version_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_text text;
  v_plot jsonb;
  v_version_no integer;
  v_audit public.audit_attempt_log%ROWTYPE;
  v_package jsonb;
  v_editorial_id uuid;
  v_entry jsonb;
  v_world_id uuid;
  v_relation_id uuid;
  v_char_id uuid;
  v_baseline_state_id uuid;
  v_new_state_id uuid;
  v_memory_id uuid;
  v_asset_id uuid;
  v_relation_log_id uuid;
  v_header public.chapter_header%ROWTYPE;
  v_current_world jsonb;
  v_current_relation jsonb;
  v_current_state public.character_live_state%ROWTYPE;
  v_current_state_json jsonb;
  v_writeback_id uuid := gen_random_uuid();
  v_world_diff jsonb := '[]'::jsonb;
  v_char_diff jsonb := '[]'::jsonb;
  v_relation_diff jsonb := '[]'::jsonb;
  v_asset_diff jsonb := '[]'::jsonb;
  v_memory_ids jsonb := '[]'::jsonb;
  v_live_state_ids jsonb := '[]'::jsonb;
  v_relation_log_ids jsonb := '[]'::jsonb;
  v_world_ids uuid[] := ARRAY[]::uuid[];
  v_char_ids uuid[] := ARRAY[]::uuid[];
  v_relation_ids uuid[] := ARRAY[]::uuid[];
  v_asset_ids uuid[] := ARRAY[]::uuid[];
  v_word_count integer;
  v_chapter_words integer;
  v_result jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_chapter := NULLIF(p_request->>'chapter_id', '')::uuid;
    v_version_id := NULLIF(p_request->>'chapter_version_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The formal chapter identifiers are invalid.');
  END;
  IF v_chapter IS NULL OR v_version_id IS NULL
     OR NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;
  IF NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A valid idempotency_key is required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_commit_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_commit_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT cv.prose_text, cv.candidate_plot_sim_json, cv.version_no
    INTO v_text, v_plot, v_version_no
  FROM public.chapter_version AS cv
  JOIN public.chapter_header AS h ON h.id = cv.chapter_id
  WHERE cv.id = v_version_id
    AND cv.chapter_id = v_chapter
    AND cv.book_id = v_book
    AND cv.version_state = 'candidate'
    AND cv.deduction_locked
    AND NOT h.is_finalized
    AND h.l1a_unit_id = (SELECT current_l1a_id FROM public.book_project WHERE id = v_book)
  FOR UPDATE OF cv, h;
  IF NOT FOUND OR COALESCE(btrim(v_text), '') = '' OR v_plot IS NULL THEN
    RETURN public.v7_error('FORMAL_TARGET_REJECTED', 'Formal submission requires the current locked candidate prose and deduction snapshot.');
  END IF;

  SELECT * INTO v_audit
  FROM public.audit_attempt_log
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id
    AND audit_type = 'objective'
    AND audit_status = 'completed'
    AND candidate_text_snapshot = v_text
    AND is_valid
    AND NOT is_shadow
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND
     OR v_audit.has_p0_blocker IS DISTINCT FROM false
     OR jsonb_typeof(v_audit.p0_items_json) IS DISTINCT FROM 'array'
     OR v_audit.p0_items_json <> '[]'::jsonb
     OR jsonb_typeof(v_audit.return_route_suggestion_jsonb) IS DISTINCT FROM 'object'
     OR v_audit.return_route_suggestion_jsonb <> '{}'::jsonb THEN
    RETURN public.v7_error('OBJECTIVE_AUDIT_REJECTED', 'Formal submission requires the latest matching objective audit without a return route.');
  END IF;
  v_package := v_audit.audited_handoff_package_jsonb;
  IF jsonb_typeof(v_package) IS DISTINCT FROM 'object'
     OR v_package->>'audit_attempt_id' IS DISTINCT FROM v_audit.id::text
     OR v_package->>'chapter_version_id' IS DISTINCT FROM v_version_id::text
     OR jsonb_typeof(v_package->'package_schema_version') IS DISTINCT FROM 'number'
     OR (v_package->>'package_schema_version')::integer <> 1
     OR (v_package->>'formalization_eligible')::boolean IS DISTINCT FROM true
     OR jsonb_typeof(v_package->'world_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_package->'character_live_state_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_package->'relation_changes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_package->'memories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_package->'narrative_assets') IS DISTINCT FROM 'array' THEN
    RETURN public.v7_error('AUDIT_HANDOFF_REJECTED', 'Formal submission requires the exact complete audited candidate handoff package.');
  END IF;
  SELECT id INTO v_editorial_id
  FROM public.editor_log
  WHERE book_id = v_book
    AND chapter_id = v_chapter
    AND chapter_version_id = v_version_id
    AND phase = 'editorial'
    AND is_valid
    AND NOT is_shadow
    AND created_at >= v_audit.created_at
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.editor_log
    WHERE id = v_editorial_id
      AND decision_json->>'verdict' = 'Y'
      AND COALESCE((decision_json->>'force_manual')::boolean, true) IS FALSE
  ) THEN
    RETURN public.v7_error('EDITORIAL_APPROVAL_REQUIRED', 'Formal submission requires the current candidate chief-editor Y decision.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.editor_log
    WHERE book_id = v_book AND chapter_id = v_chapter AND chapter_version_id = v_version_id
      AND phase = 'reader' AND is_valid AND NOT is_shadow AND created_at >= v_audit.created_at
  ) OR NOT EXISTS (
    SELECT 1 FROM public.editor_log
    WHERE book_id = v_book AND chapter_id = v_chapter AND chapter_version_id = v_version_id
      AND phase = 'commercial' AND is_valid AND NOT is_shadow AND created_at >= v_audit.created_at
  ) THEN
    RETURN public.v7_error('REVIEW_EVIDENCE_INCOMPLETE', 'Formal submission requires the current reader and commercial evidence.');
  END IF;

  SELECT * INTO v_header
  FROM public.chapter_header
  WHERE id = v_chapter AND book_id = v_book
  FOR UPDATE;
  SELECT COALESCE(chapter_words, 0) INTO v_chapter_words
  FROM public.book_project WHERE id = v_book;
  v_word_count := public.v7_count_han_and_punctuation(v_text);

  -- Lock and validate every audited change before the first write. Any stale
  -- baseline rejects the whole formalization rather than leaving partial truth.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'world_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'world_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every formal world change needs one stable ID, before/after values, and event evidence.');
    END IF;
    v_world_id := (v_entry->>'world_state_id')::uuid;
    IF v_world_id = ANY(v_world_ids) THEN
      RETURN public.v7_error('AUDIT_HANDOFF_REJECTED', 'A formal handoff cannot write the same world state twice.');
    END IF;
    SELECT atom_value_jsonb INTO v_current_world
    FROM public.world_state
    WHERE id = v_world_id AND book_id = v_book
      AND setting_layer = 'initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_world IS DISTINCT FROM v_entry->'before' THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'A world handoff baseline no longer matches the current formal world state.');
    END IF;
    v_world_ids := array_append(v_world_ids, v_world_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'character_live_state_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'character_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR (NULLIF(v_entry->>'baseline_live_state_id', '') IS NOT NULL
           AND v_entry->>'baseline_live_state_id' !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
       OR COALESCE(v_entry->>'change_type', '') = ''
       OR jsonb_typeof(v_entry->'change_layer') IS DISTINCT FROM 'number'
       OR (v_entry->>'change_layer')::integer NOT BETWEEN 0 AND 3
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR NOT (v_entry->'after' ?& ARRAY[
         'philosophy_live_json', 'emotion_state_json', 'drive_live_json', 'trigger_state_json',
         'goal_state_json', 'pressure_level', 'current_goal_txt', 'current_emo_tag'
       ])
       OR jsonb_typeof(v_entry->'after'->'pressure_level') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every formal character change needs a complete live-state snapshot and event evidence.');
    END IF;
    v_char_id := (v_entry->>'character_id')::uuid;
    v_baseline_state_id := NULLIF(v_entry->>'baseline_live_state_id', '')::uuid;
    IF v_char_id = ANY(v_char_ids) THEN
      RETURN public.v7_error('AUDIT_HANDOFF_REJECTED', 'A formal handoff cannot write the same character state twice.');
    END IF;
    PERFORM 1 FROM public.character
    WHERE id = v_char_id AND book_id = v_book AND is_formal AND is_valid AND NOT is_shadow
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN public.v7_error('HANDOFF_SCOPE_REJECTED', 'A character handoff does not belong to the formal current book scope.');
    END IF;
    SELECT * INTO v_current_state
    FROM public.character_live_state
    WHERE character_id = v_char_id AND is_formal AND is_valid AND NOT is_shadow
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;
    IF v_baseline_state_id IS NULL THEN
      IF FOUND THEN
        RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'The first-chapter state projection is stale because a formal live state now exists.');
      END IF;
    ELSE
      IF NOT FOUND OR v_current_state.id IS DISTINCT FROM v_baseline_state_id THEN
        RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'A character handoff baseline no longer matches the current formal live state.');
      END IF;
      v_current_state_json := jsonb_build_object(
        'philosophy_live_json', v_current_state.philosophy_live_json,
        'emotion_state_json', v_current_state.emotion_state_json,
        'drive_live_json', v_current_state.drive_live_json,
        'trigger_state_json', v_current_state.trigger_state_json,
        'goal_state_json', v_current_state.goal_state_json,
        'pressure_level', v_current_state.pressure_level,
        'current_goal_txt', v_current_state.current_goal_txt,
        'current_emo_tag', v_current_state.current_emo_tag
      );
      IF v_current_state_json IS DISTINCT FROM v_entry->'before' THEN
        RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'A character handoff before snapshot no longer matches the formal live state.');
      END IF;
    END IF;
    v_char_ids := array_append(v_char_ids, v_char_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'relation_changes')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'relation_state_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_a_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'char_b_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry->'before') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'after') IS DISTINCT FROM 'object'
       OR NOT (v_entry->'after' ?& ARRAY[
         'trust', 'intimacy', 'power_balance', 'dependence', 'hostility', 'common_goal',
         'secret_known', 'emotional_bond', 'relation_type', 'relation_hierarchy',
         'relation_origin', 'relation_overview', 'change_event_json'
       ])
       OR jsonb_typeof(v_entry->'change_event') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every formal relation change needs a complete before/after snapshot and event evidence.');
    END IF;
    v_relation_id := (v_entry->>'relation_state_id')::uuid;
    IF v_relation_id = ANY(v_relation_ids) THEN
      RETURN public.v7_error('AUDIT_HANDOFF_REJECTED', 'A formal handoff cannot write the same relation twice.');
    END IF;
    SELECT jsonb_build_object(
      'trust', trust, 'intimacy', intimacy, 'power_balance', power_balance,
      'dependence', dependence, 'hostility', hostility, 'common_goal', common_goal,
      'secret_known', secret_known, 'emotional_bond', emotional_bond,
      'relation_type', relation_type, 'relation_hierarchy', relation_hierarchy,
      'relation_origin', relation_origin, 'relation_overview', relation_overview,
      'change_event_json', change_event_json
    ) INTO v_current_relation
    FROM public.relation_state
    WHERE id = v_relation_id
      AND book_id = v_book
      AND char_a_id = (v_entry->>'char_a_id')::uuid
      AND char_b_id = (v_entry->>'char_b_id')::uuid
      AND is_formal AND is_valid AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND OR v_current_relation IS DISTINCT FROM v_entry->'before' THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'A relation handoff baseline no longer matches the current formal relation state.');
    END IF;
    v_relation_ids := array_append(v_relation_ids, v_relation_id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'memories')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'character_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR COALESCE(v_entry->>'memory_type', '') NOT IN ('event', 'emotion', 'knowledge', 'relationship')
       OR COALESCE(btrim(v_entry->>'memory_content'), '') = ''
       OR COALESCE(v_entry->>'truth_status', '') NOT IN ('true', 'misremembered', 'false')
       OR jsonb_typeof(v_entry->'importance') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_entry->'decay_rate') IS DISTINCT FROM 'number'
       OR (v_entry->>'importance')::numeric NOT BETWEEN 0 AND 1
       OR (v_entry->>'decay_rate')::numeric NOT BETWEEN 0 AND 1
       OR jsonb_typeof(v_entry->'event_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'event_ids') = 0 THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every formal memory needs a scoped character, retention values, and event evidence.');
    END IF;
    PERFORM 1 FROM public.character
    WHERE id = (v_entry->>'character_id')::uuid
      AND book_id = v_book AND is_formal AND is_valid AND NOT is_shadow
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN public.v7_error('HANDOFF_SCOPE_REJECTED', 'A formal memory does not belong to the current book scope.');
    END IF;
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'narrative_assets')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR COALESCE(v_entry->>'candidate_asset_id', '') !~* '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RETURN public.v7_error('AUDIT_HANDOFF_INCOMPLETE', 'Every formal narrative asset needs the stable candidate asset ID assigned by objective audit.');
    END IF;
    v_asset_id := (v_entry->>'candidate_asset_id')::uuid;
    IF v_asset_id = ANY(v_asset_ids) THEN
      RETURN public.v7_error('AUDIT_HANDOFF_REJECTED', 'A formal handoff cannot promote the same narrative asset twice.');
    END IF;
    PERFORM 1 FROM public.narrative_asset
    WHERE id = v_asset_id AND book_id = v_book
      AND linked_chapter_id = v_chapter AND chapter_version_id = v_version_id
      AND NOT is_formal AND is_valid AND NOT is_shadow
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('HANDOFF_BASELINE_STALE', 'An audited candidate narrative asset is no longer available for formalization.');
    END IF;
    v_asset_ids := array_append(v_asset_ids, v_asset_id);
  END LOOP;

  PERFORM public.v7_enable_internal_write();
  INSERT INTO public.writeback_log(
    id, book_id, chapter_id, chapter_version_id, transaction_id, writeback_scope_jsonb,
    world_diff_json, char_diff_json, relation_diff_json, asset_diff_json, status, source_version_no
  ) VALUES (
    v_writeback_id, v_book, v_chapter, v_version_id, gen_random_uuid(),
    jsonb_build_object(
      'audit_attempt_id', v_audit.id::text,
      'package_schema_version', v_package->'package_schema_version',
      'editorial_log_id', v_editorial_id::text,
      'chapter_header_before', jsonb_build_object(
        'status', v_header.status,
        'run_status', v_header.run_status,
        'is_finalized', v_header.is_finalized,
        'confirmation_status', v_header.confirmation_status,
        'word_count', v_header.word_count
      ),
      'chapter_header_after', jsonb_build_object(
        'status', 'confirmed',
        'run_status', 'awaiting_creator_confirmation',
        'is_finalized', true,
        'confirmation_status', 'unconfirmed',
        'word_count', v_word_count
      ),
      'memory_ids', '[]'::jsonb,
      'character_live_state_ids', '[]'::jsonb,
      'relation_state_log_ids', '[]'::jsonb
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'success', v_version_no::text
  );
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'world_changes')
  LOOP
    v_world_id := (v_entry->>'world_state_id')::uuid;
    UPDATE public.world_state SET atom_value_jsonb = v_entry->'after' WHERE id = v_world_id;
    v_world_diff := v_world_diff || jsonb_build_array(jsonb_build_object(
      'world_state_id', v_world_id::text, 'before', v_entry->'before', 'after', v_entry->'after',
      'event_ids', v_entry->'event_ids'
    ));
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'character_live_state_changes')
  LOOP
    v_char_id := (v_entry->>'character_id')::uuid;
    v_baseline_state_id := NULLIF(v_entry->>'baseline_live_state_id', '')::uuid;
    IF v_baseline_state_id IS NOT NULL THEN
      UPDATE public.character_live_state SET is_formal = false WHERE id = v_baseline_state_id;
    END IF;
    INSERT INTO public.character_live_state(
      book_id, character_id, chapter_id, chapter_version_id, predecessor_state_id,
      philosophy_live_json, emotion_state_json, drive_live_json, trigger_state_json, goal_state_json,
      pressure_level, current_goal_txt, current_emo_tag, is_formal, is_shadow, is_valid
    ) VALUES (
      v_book, v_char_id, v_chapter, v_version_id, v_baseline_state_id,
      v_entry->'after'->'philosophy_live_json', v_entry->'after'->'emotion_state_json',
      v_entry->'after'->'drive_live_json', v_entry->'after'->'trigger_state_json',
      v_entry->'after'->'goal_state_json', (v_entry->'after'->>'pressure_level')::numeric,
      v_entry->'after'->>'current_goal_txt', v_entry->'after'->>'current_emo_tag', true, false, true
    ) RETURNING id INTO v_new_state_id;
    INSERT INTO public.character_writeback_log(
      book_id, chapter_id, chapter_version_id, char_id, change_type, change_layer,
      old_values_jsonb, new_values_jsonb, writeback_log_id, change_reason
    ) VALUES (
      v_book, v_chapter, v_version_id, v_char_id, v_entry->>'change_type',
      (v_entry->>'change_layer')::integer, v_entry->'before', v_entry->'after',
      v_writeback_id, v_entry->>'change_reason'
    );
    v_live_state_ids := v_live_state_ids || jsonb_build_array(v_new_state_id::text);
    v_char_diff := v_char_diff || jsonb_build_array(jsonb_build_object(
      'character_id', v_char_id::text, 'baseline_live_state_id', v_baseline_state_id,
      'new_live_state_id', v_new_state_id::text, 'before', v_entry->'before', 'after', v_entry->'after'
    ));
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'relation_changes')
  LOOP
    v_relation_id := (v_entry->>'relation_state_id')::uuid;
    UPDATE public.relation_state
    SET trust = (v_entry->'after'->>'trust')::integer,
        intimacy = (v_entry->'after'->>'intimacy')::integer,
        power_balance = (v_entry->'after'->>'power_balance')::integer,
        dependence = (v_entry->'after'->>'dependence')::integer,
        hostility = (v_entry->'after'->>'hostility')::integer,
        common_goal = (v_entry->'after'->>'common_goal')::integer,
        secret_known = (v_entry->'after'->>'secret_known')::integer,
        emotional_bond = (v_entry->'after'->>'emotional_bond')::integer,
        relation_type = v_entry->'after'->>'relation_type',
        relation_hierarchy = v_entry->'after'->>'relation_hierarchy',
        relation_origin = v_entry->'after'->>'relation_origin',
        relation_overview = v_entry->'after'->>'relation_overview',
        change_event_json = v_entry->'after'->'change_event_json'
    WHERE id = v_relation_id;
    INSERT INTO public.relation_state_log(
      book_id, chapter_id, chapter_version_id, relation_state_id,
      change_event_jsonb, before_snapshot_jsonb, after_snapshot_jsonb, is_valid, is_shadow
    ) VALUES (
      v_book, v_chapter, v_version_id, v_relation_id,
      v_entry->'change_event', v_entry->'before', v_entry->'after', true, false
    ) RETURNING id INTO v_relation_log_id;
    v_relation_log_ids := v_relation_log_ids || jsonb_build_array(v_relation_log_id::text);
    v_relation_diff := v_relation_diff || jsonb_build_array(jsonb_build_object(
      'relation_state_id', v_relation_id::text,
      'char_a_id', v_entry->>'char_a_id', 'char_b_id', v_entry->>'char_b_id',
      'before', v_entry->'before', 'after', v_entry->'after',
      'relation_state_log_id', v_relation_log_id::text, 'event_ids', v_entry->'event_ids'
    ));
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'memories')
  LOOP
    INSERT INTO public.character_memory(
      book_id, char_id, chapter_id, chapter_version_id, memory_type, memory_content,
      truth_status, importance, decay_rate, is_valid, is_shadow
    ) VALUES (
      v_book, (v_entry->>'character_id')::uuid, v_chapter, v_version_id,
      v_entry->>'memory_type', v_entry->>'memory_content', v_entry->>'truth_status',
      (v_entry->>'importance')::numeric, (v_entry->>'decay_rate')::numeric, true, false
    ) RETURNING id INTO v_memory_id;
    v_memory_ids := v_memory_ids || jsonb_build_array(v_memory_id::text);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_package->'narrative_assets')
  LOOP
    v_asset_id := (v_entry->>'candidate_asset_id')::uuid;
    UPDATE public.narrative_asset
    SET is_formal = true
    WHERE id = v_asset_id;
    v_asset_diff := v_asset_diff || jsonb_build_array(jsonb_build_object(
      'asset_id', v_asset_id::text, 'asset_ref', v_entry->>'asset_ref',
      'before', jsonb_build_object('is_formal', false, 'is_valid', true, 'is_shadow', false),
      'after', jsonb_build_object('is_formal', true, 'is_valid', true, 'is_shadow', false)
    ));
  END LOOP;
  UPDATE public.chapter_version
  SET version_state = 'formal', is_formal = true, is_shadow = false, is_valid = true,
      formal_plot_sim_json = v_plot,
      formal_sublimation_json = shadow_sublimation_json,
      review_decision = 'Y'
  WHERE id = v_version_id;
  UPDATE public.chapter_header
  SET status = 'confirmed', run_status = 'awaiting_creator_confirmation',
      is_finalized = true, confirmation_status = 'unconfirmed', word_count = v_word_count
  WHERE id = v_chapter;
  UPDATE public.writeback_log
  SET writeback_scope_jsonb = writeback_scope_jsonb || jsonb_build_object(
        'memory_ids', v_memory_ids,
        'character_live_state_ids', v_live_state_ids,
        'relation_state_log_ids', v_relation_log_ids
      ),
      world_diff_json = v_world_diff,
      char_diff_json = v_char_diff,
      relation_diff_json = v_relation_diff,
      asset_diff_json = v_asset_diff
  WHERE id = v_writeback_id;
  v_result := jsonb_build_object(
    'ok', true,
    'book_id', v_book,
    'ids', jsonb_build_object(
      'chapter_id', v_chapter,
      'chapter_version_id', v_version_id,
      'audit_attempt_id', v_audit.id,
      'editorial_log_id', v_editorial_id,
      'writeback_log_id', v_writeback_id
    ),
    'state', jsonb_build_object(
      'version_state', 'formal',
      'confirmation_status', 'unconfirmed',
      'next_action', 'await_creator_confirmation'
    ),
    'word_count', v_word_count,
    'word_count_delta', v_word_count - v_chapter_words
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_commit_chapter', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_manage_skill(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_skill_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_action text := p_request->>'action';
  v_status text := p_request->>'status';
  v_slug text := btrim(COALESCE(p_request->>'stable_slug', ''));
  v_category text := p_request->>'skill_category';
  v_source_key text;
  v_version integer;
  v_version_id uuid;
  v_result jsonb;
  v_genre jsonb := NULLIF(p_request->'genre_main', 'null'::jsonb);
  v_tags jsonb := COALESCE(p_request->'skill_tags_jsonb', '[]'::jsonb);
  v_stages jsonb := COALESCE(p_request->'applicable_stages', '[]'::jsonb);
  v_scopes jsonb := COALESCE(p_request->'applicable_scopes', '{}'::jsonb);
  v_constraints jsonb := COALESCE(p_request->'constraint_fields', '{}'::jsonb);
  v_templates jsonb := COALESCE(p_request->'template_fields', '{}'::jsonb);
  v_confirmed boolean;
  v_import_items jsonb := p_request->'skills';
  v_import_item jsonb;
  v_import_skill_ids uuid[] := ARRAY[]::uuid[];
  v_import_slugs text[] := ARRAY[]::text[];
  v_import_updated jsonb := '[]'::jsonb;
  v_import_count integer := 0;
  v_import_source_type text;
  v_import_owner uuid;
  v_import_lifecycle text;
  v_import_skill public.skill%ROWTYPE;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
    v_skill_id := NULLIF(p_request->>'skill_id', '')::uuid;
    v_confirmed := COALESCE(NULLIF(p_request->>'creator_confirmed', '')::boolean, false);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id, optional book_id, and optional skill_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_operator(v_operator)
     OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator, v_book)) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected operator or book scope is unavailable.');
  END IF;
  IF COALESCE(v_action, '') NOT IN ('create_version', 'set_preference', 'delete', 'import_overwrite')
     OR NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'action and a valid idempotency_key are required.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_manage_skill', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_manage_skill', v_key, v_operator, v_book, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  IF v_action = 'create_version' THEN
    IF v_slug = ''
       OR COALESCE(p_request->>'skill_name', '') = ''
       OR COALESCE(p_request->>'skill_description', '') = ''
       OR COALESCE(v_category, '') NOT IN ('题材组合', '章节展开', '艺术呈现', '镜头语言')
       OR jsonb_typeof(p_request->'skill_config_jsonb') <> 'object'
       OR jsonb_typeof(v_tags) <> 'array'
       OR jsonb_typeof(v_stages) <> 'array'
       OR jsonb_typeof(v_scopes) <> 'object'
       OR jsonb_typeof(v_constraints) <> 'object'
       OR jsonb_typeof(v_templates) <> 'object' THEN
      RETURN public.v7_error('SKILL_INCOMPLETE', 'A user-managed skill version needs its stable slug, identity fields, category, configuration object, and typed applicability fields.');
    END IF;
    IF (v_genre IS NOT NULL AND jsonb_typeof(v_genre) <> 'object')
       OR (v_category = '题材组合' AND COALESCE(v_genre->>'primary', '') NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人'))
       OR (v_category <> '题材组合' AND v_genre IS NOT NULL AND v_genre ? 'primary' AND v_genre->>'primary' NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')) THEN
      RETURN public.v7_error('SKILL_PRIMARY_GENRE_REJECTED', 'A primary genre, when present, must be one of the six approved genres; 末世 is a subgenre only.');
    END IF;
    IF v_skill_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.skill_identity WHERE stable_slug = v_slug) THEN
        RETURN public.v7_error('SKILL_SLUG_EXISTS', 'The stable skill slug is already in use.');
      END IF;
      v_skill_id := gen_random_uuid();
      v_source_key := 'user-managed:' || v_operator::text || ':' || v_skill_id::text;
      v_version := 1;
      PERFORM public.v7_enable_internal_write();
      INSERT INTO public.skill_identity(skill_id, stable_slug, source_key)
      VALUES (v_skill_id, v_slug, v_source_key);
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.skill
        WHERE skill_id = v_skill_id AND source_type = 'system_builtin'
      ) THEN
        RETURN public.v7_error('BUILTIN_READ_ONLY', 'System built-in skills cannot be edited or versioned by FP015.');
      END IF;
      SELECT si.source_key, si.stable_slug, COALESCE(max(s.version), 0) + 1
      INTO v_source_key, v_slug, v_version
      FROM public.skill_identity AS si
      JOIN public.skill AS s ON s.skill_id = si.skill_id
      WHERE si.skill_id = v_skill_id
        AND s.source_type = 'user_managed'
        AND s.owner_local_operator_id = v_operator
      GROUP BY si.source_key, si.stable_slug;
      IF NOT FOUND THEN
        RETURN public.v7_error('SKILL_SCOPE_REJECTED', 'The user-managed skill is unavailable to this local operator.');
      END IF;
      IF p_request->>'stable_slug' IS DISTINCT FROM v_slug THEN
        RETURN public.v7_error('SKILL_IDENTITY_IMMUTABLE', 'A new version must retain the existing stable skill slug.');
      END IF;
      PERFORM public.v7_enable_internal_write();
      UPDATE public.skill
      SET lifecycle_status = 'archived'
      WHERE skill_id = v_skill_id
        AND source_type = 'user_managed'
        AND owner_local_operator_id = v_operator
        AND lifecycle_status = 'active';
    END IF;

    INSERT INTO public.skill(
      skill_id, source_key, stable_slug, version, source_type, owner_local_operator_id,
      source_locator, source_file_sha256, source_sha256, skill_name, skill_category,
      skill_description, genre_main, skill_tags_jsonb, combo_logic, fun_source, essence,
      arc_structure, applicable_scene, ai_rating, applicable_stages, applicable_scopes,
      constraint_fields, template_fields, skill_config_jsonb, lifecycle_status
    ) VALUES (
      v_skill_id, v_source_key, v_slug, v_version, 'user_managed', v_operator,
      'user-managed:' || v_skill_id::text || ':v' || v_version::text,
      NULL,
      encode(digest(convert_to((p_request->'skill_config_jsonb')::text, 'UTF8'), 'sha256'), 'hex'),
      p_request->>'skill_name', v_category, p_request->>'skill_description', v_genre,
      v_tags, p_request->'combo_logic', p_request->>'fun_source', p_request->>'essence',
      p_request->'arc_structure', p_request->'applicable_scene', p_request->>'ai_rating',
      v_stages, v_scopes, v_constraints, v_templates, p_request->'skill_config_jsonb', 'active'
    ) RETURNING id INTO v_version_id;
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('skill_id', v_skill_id, 'skill_version_id', v_version_id),
      'state', jsonb_build_object('lifecycle_status', 'active', 'version', v_version)
    );

  ELSIF v_action = 'set_preference' THEN
    IF v_book IS NULL
       OR v_skill_id IS NULL
       OR COALESCE(v_status, '') NOT IN ('active', 'disabled') THEN
      RETURN public.v7_error('INVALID_REQUEST', 'A book-scoped skill_id and status active or disabled are required.');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.skill AS s
      WHERE s.skill_id = v_skill_id
        AND s.lifecycle_status = 'active'
        AND s.source_type = 'user_managed'
        AND s.owner_local_operator_id = v_operator
    ) THEN
      RETURN public.v7_error('SKILL_SCOPE_REJECTED', 'Only an active user-managed skill owned by this local operator can receive a book preference.');
    END IF;
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.book_skill_preference(book_id, skill_id, status, updated_by)
    VALUES (v_book, v_skill_id, v_status, v_operator)
    ON CONFLICT (book_id, skill_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_by = EXCLUDED.updated_by,
        updated_at = clock_timestamp();
    v_result := jsonb_build_object(
      'ok', true,
      'book_id', v_book,
      'ids', jsonb_build_object('skill_id', v_skill_id),
      'state', jsonb_build_object('preference_status', v_status)
    );

  ELSIF v_action = 'import_overwrite' THEN
    IF jsonb_typeof(v_import_items) <> 'array'
       OR jsonb_array_length(v_import_items) = 0 THEN
      RETURN public.v7_error('SKILL_IMPORT_INCOMPLETE', 'Importing skills requires a non-empty skills array.');
    END IF;

    -- Validate every row before taking any write path. A returned error after an
    -- UPDATE would otherwise leave earlier rows committed by this RPC call.
    FOR v_import_item IN SELECT value FROM jsonb_array_elements(v_import_items)
    LOOP
      v_import_count := v_import_count + 1;
      IF jsonb_typeof(v_import_item) <> 'object'
         OR NOT v_import_item ?& ARRAY[
           'skill_id', 'stable_slug', 'skill_name', 'skill_description', 'skill_category',
           'genre_main', 'skill_tags_jsonb', 'combo_logic', 'fun_source', 'essence',
           'arc_structure', 'applicable_scene', 'ai_rating', 'applicable_stages',
           'applicable_scopes', 'constraint_fields', 'template_fields', 'skill_config_jsonb'
         ] THEN
        RETURN public.v7_error('SKILL_IMPORT_INCOMPLETE', 'Every imported skill needs its stable identity and every editable content field.');
      END IF;
      BEGIN
        v_skill_id := NULLIF(btrim(v_import_item->>'skill_id'), '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN public.v7_error('SKILL_IMPORT_IDENTITY_REJECTED', 'Every imported skill needs a valid stable skill_id.');
      END;
      v_slug := btrim(COALESCE(v_import_item->>'stable_slug', ''));
      IF v_skill_id IS NULL OR v_slug = ''
         OR v_skill_id = ANY(v_import_skill_ids)
         OR v_slug = ANY(v_import_slugs) THEN
        RETURN public.v7_error('SKILL_IMPORT_IDENTITY_REJECTED', 'Imported stable skill identities must be complete and unique within the batch.');
      END IF;
      IF v_import_item ? 'source_type'
         AND COALESCE(v_import_item->>'source_type', '') <> 'user_managed' THEN
        RETURN public.v7_error('BUILTIN_READ_ONLY', 'Only exported user-managed skills can be imported.');
      END IF;
      IF v_import_item ? 'owner_local_operator_id'
         AND jsonb_typeof(v_import_item->'owner_local_operator_id') <> 'null' THEN
        BEGIN
          v_import_owner := (v_import_item->>'owner_local_operator_id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RETURN public.v7_error('SKILL_IMPORT_IDENTITY_REJECTED', 'An imported owner identifier must be a valid UUID when supplied.');
        END;
        IF v_import_owner IS DISTINCT FROM v_operator THEN
          RETURN public.v7_error('SKILL_SCOPE_REJECTED', 'Imported skills must remain owned by the current local operator.');
        END IF;
      END IF;
      IF v_import_item ? 'lifecycle_status'
         AND COALESCE(v_import_item->>'lifecycle_status', '') <> 'active' THEN
        RETURN public.v7_error('SKILL_IMPORT_IDENTITY_REJECTED', 'Only an exported active personal skill can be directly replaced.');
      END IF;
      IF jsonb_typeof(v_import_item->'skill_name') <> 'string'
         OR btrim(COALESCE(v_import_item->>'skill_name', '')) = ''
         OR jsonb_typeof(v_import_item->'skill_description') <> 'string'
         OR btrim(COALESCE(v_import_item->>'skill_description', '')) = ''
         OR COALESCE(v_import_item->>'skill_category', '') NOT IN ('题材组合', '章节展开', '艺术呈现', '镜头语言')
         OR jsonb_typeof(v_import_item->'genre_main') NOT IN ('object', 'null')
         OR jsonb_typeof(v_import_item->'skill_tags_jsonb') <> 'array'
         OR jsonb_typeof(v_import_item->'combo_logic') NOT IN ('object', 'null')
         OR jsonb_typeof(v_import_item->'fun_source') NOT IN ('string', 'null')
         OR jsonb_typeof(v_import_item->'essence') NOT IN ('string', 'null')
         OR jsonb_typeof(v_import_item->'arc_structure') NOT IN ('object', 'null')
         OR jsonb_typeof(v_import_item->'applicable_scene') NOT IN ('object', 'null')
         OR jsonb_typeof(v_import_item->'ai_rating') NOT IN ('string', 'null')
         OR (jsonb_typeof(v_import_item->'ai_rating') = 'string' AND v_import_item->>'ai_rating' NOT IN ('SS', 'S', 'A', 'B', 'C'))
         OR jsonb_typeof(v_import_item->'applicable_stages') <> 'array'
         OR jsonb_typeof(v_import_item->'applicable_scopes') <> 'object'
         OR jsonb_typeof(v_import_item->'constraint_fields') <> 'object'
         OR jsonb_typeof(v_import_item->'template_fields') <> 'object'
         OR jsonb_typeof(v_import_item->'skill_config_jsonb') <> 'object' THEN
        RETURN public.v7_error('SKILL_IMPORT_INCOMPLETE', 'Imported skill content has an unsupported field or type.');
      END IF;
      IF (v_import_item->>'skill_category' = '题材组合' AND (
            jsonb_typeof(v_import_item->'genre_main') <> 'object'
            OR COALESCE(v_import_item->'genre_main'->>'primary', '') NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')
          ))
         OR (v_import_item->>'skill_category' <> '题材组合'
             AND jsonb_typeof(v_import_item->'genre_main') = 'object'
             AND v_import_item->'genre_main' ? 'primary'
             AND v_import_item->'genre_main'->>'primary' NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人')) THEN
        RETURN public.v7_error('SKILL_PRIMARY_GENRE_REJECTED', 'A primary genre, when present, must be one of the six approved genres; 末世 is a subgenre only.');
      END IF;
      v_import_skill_ids := array_append(v_import_skill_ids, v_skill_id);
      v_import_slugs := array_append(v_import_slugs, v_slug);
    END LOOP;

    -- Lock and verify every target before the first UPDATE. Imported metadata is
    -- evidence only; the stored identity, version, owner and lifecycle stay fixed.
    FOR v_import_item IN SELECT value FROM jsonb_array_elements(v_import_items)
    LOOP
      v_skill_id := (v_import_item->>'skill_id')::uuid;
      v_slug := v_import_item->>'stable_slug';
      SELECT s.* INTO v_import_skill
      FROM public.skill AS s
      JOIN public.skill_identity AS si ON si.skill_id = s.skill_id
      WHERE s.skill_id = v_skill_id
        AND s.stable_slug = v_slug
        AND si.stable_slug = v_slug
        AND s.source_type = 'user_managed'
        AND s.owner_local_operator_id = v_operator
        AND s.lifecycle_status = 'active'
      FOR UPDATE OF s;
      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1 FROM public.skill
          WHERE skill_id = v_skill_id AND source_type = 'system_builtin'
        ) THEN
          RETURN public.v7_error('BUILTIN_READ_ONLY', 'System built-in skills cannot be replaced by import.');
        END IF;
        RETURN public.v7_error('SKILL_IMPORT_IDENTITY_REJECTED', 'Every imported identity must match an existing active user-managed skill owned by this local operator.');
      END IF;
    END LOOP;

    PERFORM public.v7_enable_internal_write();
    FOR v_import_item IN SELECT value FROM jsonb_array_elements(v_import_items)
    LOOP
      v_skill_id := (v_import_item->>'skill_id')::uuid;
      v_slug := v_import_item->>'stable_slug';
      UPDATE public.skill AS s
      SET skill_name = v_import_item->>'skill_name',
          skill_category = v_import_item->>'skill_category',
          skill_description = v_import_item->>'skill_description',
          genre_main = NULLIF(v_import_item->'genre_main', 'null'::jsonb),
          skill_tags_jsonb = v_import_item->'skill_tags_jsonb',
          combo_logic = NULLIF(v_import_item->'combo_logic', 'null'::jsonb),
          fun_source = v_import_item->>'fun_source',
          essence = v_import_item->>'essence',
          arc_structure = NULLIF(v_import_item->'arc_structure', 'null'::jsonb),
          applicable_scene = NULLIF(v_import_item->'applicable_scene', 'null'::jsonb),
          ai_rating = v_import_item->>'ai_rating',
          applicable_stages = v_import_item->'applicable_stages',
          applicable_scopes = v_import_item->'applicable_scopes',
          constraint_fields = v_import_item->'constraint_fields',
          template_fields = v_import_item->'template_fields',
          skill_config_jsonb = v_import_item->'skill_config_jsonb',
          source_sha256 = encode(digest(convert_to(jsonb_build_object(
            'skill_name', v_import_item->>'skill_name',
            'skill_category', v_import_item->>'skill_category',
            'skill_description', v_import_item->>'skill_description',
            'genre_main', v_import_item->'genre_main',
            'skill_tags_jsonb', v_import_item->'skill_tags_jsonb',
            'combo_logic', v_import_item->'combo_logic',
            'fun_source', v_import_item->'fun_source',
            'essence', v_import_item->'essence',
            'arc_structure', v_import_item->'arc_structure',
            'applicable_scene', v_import_item->'applicable_scene',
            'ai_rating', v_import_item->'ai_rating',
            'applicable_stages', v_import_item->'applicable_stages',
            'applicable_scopes', v_import_item->'applicable_scopes',
            'constraint_fields', v_import_item->'constraint_fields',
            'template_fields', v_import_item->'template_fields',
            'skill_config_jsonb', v_import_item->'skill_config_jsonb'
          )::text, 'UTF8'), 'sha256'), 'hex')
      WHERE s.skill_id = v_skill_id
        AND s.stable_slug = v_slug
        AND s.source_type = 'user_managed'
        AND s.owner_local_operator_id = v_operator
        AND s.lifecycle_status = 'active'
      RETURNING s.id, s.version INTO v_version_id, v_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'V7_SKILL_IMPORT_TARGET_LOST';
      END IF;
      v_import_updated := v_import_updated || jsonb_build_array(jsonb_build_object(
        'skill_id', v_skill_id,
        'stable_slug', v_slug,
        'skill_version_id', v_version_id,
        'version', v_version
      ));
    END LOOP;
    v_result := jsonb_build_object(
      'ok', true,
      'book_id', v_book,
      'result', jsonb_build_object('updated', v_import_updated),
      'state', jsonb_build_object(
        'import_mode', 'direct_overwrite',
        'updated_count', v_import_count,
        'versions_changed', false,
        'preferences_changed', false
      )
    );

  ELSE
    IF v_skill_id IS NULL THEN
      RETURN public.v7_error('DELETE_CONFIRMATION_REQUIRED', 'Deleting a user-managed skill requires an explicit creator confirmation.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.skill WHERE skill_id = v_skill_id AND source_type = 'system_builtin') THEN
      RETURN public.v7_error('BUILTIN_READ_ONLY', 'System built-in skills cannot be deleted.');
    END IF;
    IF NOT v_confirmed THEN
      RETURN public.v7_error('DELETE_CONFIRMATION_REQUIRED', 'Deleting a user-managed skill requires an explicit creator confirmation.');
    END IF;
    PERFORM 1
    FROM public.skill
    WHERE skill_id = v_skill_id
      AND source_type = 'user_managed'
      AND owner_local_operator_id = v_operator
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('SKILL_SCOPE_REJECTED', 'The user-managed skill is unavailable to this local operator.');
    END IF;
    -- A disabled preference still records that a book has configured this
    -- stable skill identity. It is a business reference, not disposable state.
    IF EXISTS (
      SELECT 1 FROM public.book_skill_preference
      WHERE skill_id = v_skill_id
    ) THEN
      RETURN public.v7_error('SKILL_PREFERENCE_REFERENCE', 'The skill is still configured by a book. Disablement does not make it eligible for physical deletion.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.vector_index_log
      WHERE source_table = 'skill'
        AND source_id IN (
          SELECT id
          FROM public.skill
          WHERE skill_id = v_skill_id
            AND owner_local_operator_id = v_operator
        )
    ) THEN
      RETURN public.v7_error('SKILL_VECTOR_REFERENCE', 'The skill is retained because vector history still references one of its versions.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.iteration_log
      WHERE skill_id = v_skill_id
    ) THEN
      RETURN public.v7_error('SKILL_HISTORY_REFERENCE', 'The skill is retained because governance history still references it.');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.chapter_version AS cv
      WHERE strpos(to_jsonb(cv)::text, v_skill_id::text) > 0
    ) THEN
      RETURN public.v7_error('SKILL_CHAPTER_REFERENCE', 'The skill is retained because a current or historical chapter references it.');
    END IF;
    PERFORM public.v7_enable_internal_write();
    DELETE FROM public.skill
    WHERE skill_id = v_skill_id
      AND source_type = 'user_managed'
      AND owner_local_operator_id = v_operator;
    DELETE FROM public.skill_identity
    WHERE skill_id = v_skill_id;
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('skill_id', v_skill_id),
      'state', jsonb_build_object(
        'lifecycle_status', 'physically_deleted',
        'reference_check_scope', jsonb_build_array(
          'book_skill_preference (active or disabled)',
          'vector_index_log (source_table=skill)',
          'iteration_log',
          'chapter_version any JSON skill_id reference'
        ),
        'unknown_reference_graph', 'unresolved'
      )
    );
  END IF;

  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_manage_skill', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_effective_skills(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
  v_category text;
  v_genre text;
  v_read_mode text;
  v_skills jsonb;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A JSON request object with local_operator_id is required; effective reads also require book_id.');
  END IF;
  v_category := NULLIF(btrim(p_request->>'skill_category'), '');
  v_genre := NULLIF(btrim(p_request->>'genre_main'), '');
  v_read_mode := lower(COALESCE(NULLIF(btrim(p_request->>'read_mode'), ''), 'effective'));
  BEGIN
    v_operator := NULLIF(btrim(p_request->>'local_operator_id'), '')::uuid;
    v_book := NULLIF(btrim(p_request->>'book_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF v_read_mode NOT IN ('effective', 'management') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'read_mode must be effective or management.');
  END IF;
  IF NOT public.v7_assert_operator(v_operator)
     OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator, v_book)) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected operator or book scope is unavailable.');
  END IF;
  IF v_read_mode = 'effective' AND v_book IS NULL THEN
    RETURN public.v7_error('INVALID_REQUEST', 'effective skill reads require book_id.');
  END IF;
  IF v_genre IS NOT NULL AND v_genre NOT IN ('科幻', '玄幻', '言情', '武侠', '恐怖', '同人') THEN
    RETURN public.v7_error('INVALID_REQUEST', 'genre_main must be one of the six approved primary genres.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'skill_version_id', s.id,
    'skill_id', s.skill_id,
    'source_key', s.source_key,
    'stable_slug', s.stable_slug,
    'version', s.version,
    'source_type', s.source_type,
    'owner_local_operator_id', s.owner_local_operator_id,
    'lifecycle_status', s.lifecycle_status,
    'preference_status', CASE
      WHEN v_book IS NULL THEN NULL
      ELSE COALESCE(pref.status, 'active')
    END,
    'skill_name', s.skill_name,
    'skill_category', s.skill_category,
    'skill_description', s.skill_description,
    'genre_main', s.genre_main,
    'skill_tags_jsonb', s.skill_tags_jsonb,
    'combo_logic', s.combo_logic,
    'fun_source', s.fun_source,
    'essence', s.essence,
    'arc_structure', s.arc_structure,
    'applicable_scene', s.applicable_scene,
    'ai_rating', s.ai_rating,
    'applicable_stages', s.applicable_stages,
    'applicable_scopes', s.applicable_scopes,
    'constraint_fields', s.constraint_fields,
    'template_fields', s.template_fields,
    'skill_config_jsonb', s.skill_config_jsonb
  ) ORDER BY s.skill_name), '[]'::jsonb)
  INTO v_skills
  FROM public.skill AS s
  LEFT JOIN public.book_skill_preference AS pref
    ON pref.book_id = v_book
   AND pref.skill_id = s.skill_id
  WHERE s.lifecycle_status = 'active'
    AND (s.source_type = 'system_builtin' OR s.owner_local_operator_id = v_operator)
    AND (v_read_mode = 'management' OR COALESCE(pref.status, 'active') <> 'disabled')
    AND (v_category IS NULL OR s.skill_category = v_category)
    AND (
      v_genre IS NULL
      OR s.skill_category <> '题材组合'
      OR s.genre_main->>'primary' = v_genre
    );
  RETURN jsonb_build_object('ok', true, 'book_id', v_book, 'skills', v_skills);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_workbench(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text := lower(COALESCE(NULLIF(btrim(p_request->>'action'), ''), 'read'));
  v_operator uuid;
  v_book uuid;
  v_evidence_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_node text := NULLIF(btrim(p_request->>'node_code'), '');
  v_template text := NULLIF(btrim(p_request->>'template_type'), '');
  v_fp text := NULLIF(btrim(COALESCE(p_request->>'fp_target', p_request->>'node_code')), '');
  v_prompt_text text := p_request->>'prompt_text';
  v_provider_url text := NULLIF(btrim(p_request->>'provider_base_url'), '');
  v_model_name text := NULLIF(btrim(p_request->>'model_name'), '');
  v_api_key_ref text := NULLIF(btrim(p_request->>'api_key_ref'), '');
  v_request_hash text;
  v_existing_intent jsonb;
  v_result jsonb;
  v_log_intent jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_prompts jsonb;
  v_models jsonb;
  v_nodes jsonb;
  v_book_config jsonb;
  v_budget_config jsonb;
  v_version integer;
  v_id uuid;
  v_old_prompt text;
  v_revision text;
  v_current_l1a uuid;
  v_consumed bigint := 0;
  v_temperature numeric(3,2);
  v_binding public.model_runtime_binding%ROWTYPE;
  v_prompt public.prompt_config%ROWTYPE;
  v_model public.model_sync_config%ROWTYPE;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A JSON request object is required.');
  END IF;
  BEGIN
    v_operator := NULLIF(btrim(p_request->>'local_operator_id'), '')::uuid;
    v_book := NULLIF(btrim(p_request->>'book_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id and book_id must be UUIDs.');
  END;
  IF NOT public.v7_assert_operator(v_operator) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The local configuration scope is unavailable.');
  END IF;
  IF v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator, v_book) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.');
  END IF;

  IF v_action = 'read' THEN
    IF v_node IS NOT NULL THEN
      SELECT * INTO v_binding
      FROM public.model_runtime_binding
      WHERE local_operator_id = v_operator AND node_code = v_node;
      IF NOT FOUND THEN
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'kind', 'node_binding', 'node_code', v_node, 'reason', 'not_configured'
        ));
      ELSE
        SELECT * INTO v_model
        FROM public.model_sync_config
        WHERE local_operator_id = v_operator
          AND template_type = v_binding.template_type
          AND status = 'active' AND is_active;
        IF NOT FOUND THEN
          v_missing := v_missing || jsonb_build_array(jsonb_build_object(
            'kind', 'model_template', 'template_type', v_binding.template_type, 'reason', 'no_active_version'
          ));
        END IF;
        IF v_binding.prompt_config_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.prompt_config AS p
          WHERE p.id = v_binding.prompt_config_id
            AND p.local_operator_id = v_operator
            AND p.fp_target = v_node
            AND p.version = v_binding.prompt_version
            AND p.status = 'active' AND p.is_active
        ) THEN
          v_missing := v_missing || jsonb_build_array(jsonb_build_object(
            'kind', 'prompt', 'fp_target', v_node, 'reason', 'no_active_version'
          ));
        END IF;
      END IF;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'kind', 'node_binding',
        'node_code', b.node_code,
        'reason', CASE
          WHEN m.id IS NULL THEN 'no_active_model_for_template'
          ELSE 'no_active_prompt'
        END
      ) ORDER BY b.node_code), '[]'::jsonb)
      INTO v_missing
      FROM public.model_runtime_binding AS b
      LEFT JOIN public.model_sync_config AS m
        ON m.local_operator_id = b.local_operator_id
       AND m.template_type = b.template_type
       AND m.status = 'active' AND m.is_active
      LEFT JOIN public.prompt_config AS p
        ON p.id = b.prompt_config_id
       AND p.local_operator_id = b.local_operator_id
       AND p.fp_target = b.node_code
       AND p.version = b.prompt_version
       AND p.status = 'active' AND p.is_active
      WHERE b.local_operator_id = v_operator
        AND (m.id IS NULL OR p.id IS NULL);
    END IF;
    IF jsonb_array_length(v_missing) > 0 THEN
      RETURN public.v7_error('EFFECTIVE_CONFIG_UNAVAILABLE', 'One or more requested configurations have no valid active value.')
        || jsonb_build_object('details', jsonb_build_object('missing', v_missing));
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind', 'prompt',
      'scope', 'local_operator',
      'fp_target', p.fp_target,
      'effective_value', jsonb_build_object('prompt_text', p.prompt_text),
      'source_config_id', p.id,
      'version', p.version
    ) ORDER BY p.fp_target), '[]'::jsonb)
    INTO v_prompts
    FROM public.prompt_config AS p
    WHERE p.local_operator_id = v_operator
      AND p.status = 'active' AND p.is_active
      AND (v_node IS NULL OR p.fp_target = v_node);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind', 'model_template',
      'scope', 'local_operator',
      'template_type', m.template_type,
      'effective_value', jsonb_build_object(
        'model_name', m.model_name,
        'provider_base_url', m.provider_base_url,
        'api_key_configured', m.api_key_ref IS NOT NULL,
        'routing_config_jsonb', m.routing_config_jsonb,
        'parameters_jsonb', m.parameters_jsonb,
        'connection_tested_at', e.tested_at
      ),
      'source_config_id', m.id,
      'version', m.version
    ) ORDER BY m.template_type), '[]'::jsonb)
    INTO v_models
    FROM public.model_sync_config AS m
    JOIN public.model_connection_test_evidence AS e
      ON e.id = m.connection_test_evidence_id
     AND e.local_operator_id = m.local_operator_id
     AND e.test_succeeded
    WHERE m.local_operator_id = v_operator
      AND m.status = 'active' AND m.is_active
      AND (v_node IS NULL OR m.template_type = v_binding.template_type);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind', 'node_binding',
      'scope', 'local_operator',
      'node_code', b.node_code,
      'effective_value', jsonb_build_object(
        'template_type', b.template_type,
        'temperature', b.temperature,
        'model_config_id', m.id,
        'model_config_version', m.version,
        'prompt_config_id', p.id,
        'prompt_version', p.version
      ),
      'source_config_id', b.id,
      'version', to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ORDER BY b.node_code), '[]'::jsonb)
    INTO v_nodes
    FROM public.model_runtime_binding AS b
    JOIN public.model_sync_config AS m
      ON m.local_operator_id = b.local_operator_id
     AND m.template_type = b.template_type
     AND m.status = 'active' AND m.is_active
    JOIN public.prompt_config AS p
      ON p.id = b.prompt_config_id
     AND p.local_operator_id = b.local_operator_id
     AND p.fp_target = b.node_code
     AND p.version = b.prompt_version
     AND p.status = 'active' AND p.is_active
    WHERE b.local_operator_id = v_operator
      AND (v_node IS NULL OR b.node_code = v_node);

    IF v_book IS NOT NULL THEN
      SELECT jsonb_build_object(
        'kind', 'book_config',
        'scope', 'book',
        'effective_value', jsonb_build_object(
          'auto_production', bp.auto_production,
          'auto_audit', bp.auto_audit,
          'auto_iteration', bp.auto_iteration,
          'presentation_intensity', bp.presentation_intensity
        ),
        'source_config_id', bp.id,
        'version', bp.config_revision
      ), bp.current_l1a_id
      INTO v_book_config, v_current_l1a
      FROM public.book_project AS bp
      WHERE bp.id = v_book AND bp.local_operator_id = v_operator;

      IF v_current_l1a IS NOT NULL THEN
        SELECT COALESCE(sum(CASE
          WHEN COALESCE(cv.deduction_progress_json->>'token_consumed', '') ~ '^[0-9]+$'
          THEN (cv.deduction_progress_json->>'token_consumed')::bigint
          ELSE 0
        END), 0)
        INTO v_consumed
        FROM public.chapter_version AS cv
        JOIN public.chapter_header AS ch ON ch.id = cv.chapter_id
        WHERE cv.book_id = v_book
          AND ch.l1a_unit_id = v_current_l1a
          AND cv.version_state IN ('candidate', 'formal')
          AND cv.is_valid AND NOT cv.is_shadow;
      END IF;
      SELECT jsonb_build_object(
        'kind', 'l1a_budget',
        'scope', 'book',
        'effective_value', jsonb_build_object(
          'token_budget', bp.token_budget,
          'token_budget_version', bp.token_budget_version,
          'current_l1a_id', bp.current_l1a_id,
          'current_l1a_token_consumed', v_consumed
        ),
        'source_config_id', bp.id,
        'version', bp.token_budget_version
      )
      INTO v_budget_config
      FROM public.book_project AS bp
      WHERE bp.id = v_book AND bp.local_operator_id = v_operator;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'effective_config', jsonb_build_object(
        'prompts', v_prompts,
        'model_templates', v_models,
        'node_bindings', v_nodes,
        'book', v_book_config,
        'budget', v_budget_config
      )
    );
  END IF;

  IF v_action NOT IN ('save_prompt_active', 'save_model_template', 'bind_node_template', 'save_book_config')
     OR NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A supported workbench action and idempotency_key are required.');
  END IF;
  IF p_request ? 'token_budget' OR p_request ? 'token_budget_version' THEN
    RETURN public.v7_error('READ_ONLY_CONFIG', 'The fixed 3000000 L1A budget is read-only.');
  END IF;
  IF v_action <> 'save_book_config' AND p_request ? 'book_id' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'Prompt, model templates, and node bindings are global for this local operator and cannot carry book_id.');
  END IF;

  v_request_hash := encode(digest(convert_to(public.v7_request_intent(p_request)::text, 'UTF8'), 'sha256'), 'hex');
  SELECT intent, result INTO v_existing_intent, v_result
  FROM public.product_request_log
  WHERE operation = 'rpc_workbench'
    AND local_operator_id = v_operator
    AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_intent->>'request_sha256' IS DISTINCT FROM v_request_hash THEN
      RETURN public.v7_error('IDEMPOTENCY_KEY_REUSED', 'The idempotency key is already bound to a different workbench request.');
    END IF;
    RETURN v_result || jsonb_build_object('idempotent_replay', true);
  END IF;
  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  SELECT intent, result INTO v_existing_intent, v_result
  FROM public.product_request_log
  WHERE operation = 'rpc_workbench'
    AND local_operator_id = v_operator
    AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_intent->>'request_sha256' IS DISTINCT FROM v_request_hash THEN
      RETURN public.v7_error('IDEMPOTENCY_KEY_REUSED', 'The idempotency key is already bound to a different workbench request.');
    END IF;
    RETURN v_result || jsonb_build_object('idempotent_replay', true);
  END IF;

  IF v_action = 'save_prompt_active' THEN
    IF v_fp IS NULL OR COALESCE(v_prompt_text, '') = '' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'fp_target and prompt_text are required.');
    END IF;
    SELECT prompt_text INTO v_old_prompt
    FROM public.prompt_config
    WHERE local_operator_id = v_operator AND fp_target = v_fp AND is_active
    FOR UPDATE;
    SELECT COALESCE(max(version), 0) + 1 INTO v_version
    FROM public.prompt_config
    WHERE local_operator_id = v_operator AND fp_target = v_fp;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.prompt_config
    SET status = 'archived', is_active = false
    WHERE local_operator_id = v_operator AND fp_target = v_fp AND is_active;
    INSERT INTO public.prompt_config(
      local_operator_id, fp_target, version, prompt_text, status, is_active
    ) VALUES (
      v_operator, v_fp, v_version, v_prompt_text, 'active', true
    ) RETURNING id INTO v_id;
    UPDATE public.model_runtime_binding
    SET prompt_config_id = v_id, prompt_version = v_version
    WHERE local_operator_id = v_operator AND node_code = v_fp;
    INSERT INTO public.prompt_iteration_log(
      prompt_config_id, change_type, old_prompt_text, new_prompt_text, changed_by
    ) VALUES (
      v_id, 'workbench_active_save', v_old_prompt, v_prompt_text, v_operator
    );
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('prompt_config_id', v_id),
      'state', jsonb_build_object('scope', 'local_operator', 'fp_target', v_fp, 'status', 'active', 'version', v_version)
    );
    v_log_intent := jsonb_build_object(
      'action', v_action,
      'fp_target', v_fp,
      'prompt_sha256', encode(digest(convert_to(v_prompt_text, 'UTF8'), 'sha256'), 'hex'),
      'prompt_length', length(v_prompt_text)
    );

  ELSIF v_action = 'save_model_template' THEN
    IF p_request ? 'api_key' OR p_request ? 'connection_tested' OR p_request ? 'test_succeeded' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'API key plaintext and page-reported connection-test flags are not accepted.');
    END IF;
    IF v_template IS NULL
       OR v_template NOT IN ('感性文字', '简单逻辑', '重复指令', '复杂任务', '客观公正') THEN
      RETURN public.v7_error('INVALID_REQUEST', 'template_type must be one of the five approved model templates.');
    END IF;
    IF v_provider_url IS NULL OR v_model_name IS NULL OR v_api_key_ref IS NULL THEN
      RETURN public.v7_error('INVALID_REQUEST', 'provider_base_url, model_name, and api_key_ref are required.');
    END IF;
    IF NOT public.v7_allowed_model_credential_ref(v_api_key_ref) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'api_key_ref must name an approved deployment credential reference.');
    END IF;
    IF jsonb_typeof(COALESCE(p_request->'routing_config_jsonb', '{}'::jsonb)) <> 'object'
       OR jsonb_typeof(COALESCE(p_request->'parameters_jsonb', '{}'::jsonb)) <> 'object' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'routing_config_jsonb and parameters_jsonb must be objects.');
    END IF;
    BEGIN
      v_evidence_id := NULLIF(btrim(p_request->>'connection_test_evidence_id'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'connection_test_evidence_id must be a UUID.');
    END;
    IF v_evidence_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.model_connection_test_evidence AS e
      WHERE e.id = v_evidence_id
        AND e.local_operator_id = v_operator
        AND e.test_succeeded
        AND e.provider_base_url = v_provider_url
        AND e.model_name = v_model_name
        AND e.api_key_ref_sha256 = encode(digest(convert_to(v_api_key_ref, 'UTF8'), 'sha256'), 'hex')
    ) THEN
      RETURN public.v7_error('CONNECTION_TEST_EVIDENCE_REQUIRED', 'A successful controlled connection test for the exact address, model, and key reference is required.');
    END IF;
    SELECT COALESCE(max(version), 0) + 1 INTO v_version
    FROM public.model_sync_config
    WHERE local_operator_id = v_operator AND template_type = v_template;
    PERFORM public.v7_enable_internal_write();
    UPDATE public.model_sync_config
    SET status = 'archived', is_active = false, archived_at = clock_timestamp()
    WHERE local_operator_id = v_operator AND template_type = v_template AND is_active;
    INSERT INTO public.model_sync_config(
      local_operator_id, version, model_name, template_type, provider_base_url,
      api_key_ref, routing_config_jsonb, parameters_jsonb, status, is_active,
      connection_test_evidence_id
    ) VALUES (
      v_operator, v_version, v_model_name, v_template, v_provider_url,
      v_api_key_ref, COALESCE(p_request->'routing_config_jsonb', '{}'::jsonb),
      COALESCE(p_request->'parameters_jsonb', '{}'::jsonb), 'active', true,
      v_evidence_id
    ) RETURNING id INTO v_id;
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('model_config_id', v_id),
      'state', jsonb_build_object('scope', 'local_operator', 'template_type', v_template, 'status', 'active', 'version', v_version)
    );
    v_log_intent := jsonb_build_object(
      'action', v_action,
      'template_type', v_template,
      'provider_base_url_sha256', encode(digest(convert_to(v_provider_url, 'UTF8'), 'sha256'), 'hex'),
      'model_name', v_model_name,
      'api_key_ref_sha256', encode(digest(convert_to(v_api_key_ref, 'UTF8'), 'sha256'), 'hex'),
      'connection_test_evidence_id', v_evidence_id
    );

  ELSIF v_action = 'bind_node_template' THEN
    IF v_node IS NULL OR v_template NOT IN ('感性文字', '简单逻辑', '重复指令', '复杂任务', '客观公正') THEN
      RETURN public.v7_error('INVALID_REQUEST', 'node_code and an approved template_type are required.');
    END IF;
    IF p_request ? 'temperature' THEN
      IF jsonb_typeof(p_request->'temperature') <> 'number' THEN
        RETURN public.v7_error('INVALID_REQUEST', 'temperature must be a number between 0 and 2.');
      END IF;
      v_temperature := (p_request->>'temperature')::numeric;
      IF v_temperature NOT BETWEEN 0 AND 2 THEN
        RETURN public.v7_error('INVALID_REQUEST', 'temperature must be a number between 0 and 2.');
      END IF;
    END IF;
    SELECT * INTO v_model
    FROM public.model_sync_config
    WHERE local_operator_id = v_operator AND template_type = v_template
      AND status = 'active' AND is_active;
    IF NOT FOUND THEN
      RETURN public.v7_error('MODEL_TEMPLATE_UNAVAILABLE', 'The selected template has no active tested model configuration.');
    END IF;
    SELECT * INTO v_prompt
    FROM public.prompt_config
    WHERE local_operator_id = v_operator AND fp_target = v_node
      AND status = 'active' AND is_active;
    IF NOT FOUND THEN
      RETURN public.v7_error('PROMPT_CONFIG_UNAVAILABLE', 'The selected node has no active global prompt.');
    END IF;
    PERFORM public.v7_enable_internal_write();
    INSERT INTO public.model_runtime_binding(
      local_operator_id, node_code, prompt_config_id, prompt_version, template_type,
      temperature
    ) VALUES (
      v_operator, v_node, v_prompt.id, v_prompt.version, v_template,
      v_temperature
    )
    ON CONFLICT (local_operator_id, node_code) DO UPDATE
    SET template_type = EXCLUDED.template_type,
        prompt_config_id = EXCLUDED.prompt_config_id,
        prompt_version = EXCLUDED.prompt_version,
        temperature = EXCLUDED.temperature,
        updated_at = clock_timestamp()
    RETURNING id INTO v_id;
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('model_runtime_binding_id', v_id),
      'state', jsonb_build_object('scope', 'local_operator', 'node_code', v_node, 'template_type', v_template)
    );
    v_log_intent := jsonb_build_object('action', v_action, 'node_code', v_node, 'template_type', v_template);

  ELSE
    IF v_book IS NULL
       OR jsonb_typeof(p_request->'auto_production') <> 'boolean'
       OR jsonb_typeof(p_request->'auto_audit') <> 'boolean'
       OR jsonb_typeof(p_request->'auto_iteration') <> 'boolean'
       OR jsonb_typeof(p_request->'presentation_intensity') <> 'number' THEN
      RETURN public.v7_error('INVALID_REQUEST', 'book_id, all three automation switches, and presentation_intensity are required as a complete book configuration revision.');
    END IF;
    IF (p_request->>'presentation_intensity')::numeric NOT BETWEEN 0 AND 1 THEN
      RETURN public.v7_error('INVALID_REQUEST', 'presentation_intensity must be between 0 and 1.');
    END IF;
    v_revision := 'v7-' || replace(gen_random_uuid()::text, '-', '');
    PERFORM public.v7_enable_internal_write();
    UPDATE public.book_project
    SET auto_production = (p_request->>'auto_production')::boolean,
        auto_audit = (p_request->>'auto_audit')::boolean,
        auto_iteration = (p_request->>'auto_iteration')::boolean,
        presentation_intensity = (p_request->>'presentation_intensity')::numeric,
        config_revision = v_revision
    WHERE id = v_book AND local_operator_id = v_operator;
    v_result := jsonb_build_object(
      'ok', true,
      'ids', jsonb_build_object('book_id', v_book),
      'state', jsonb_build_object('scope', 'book', 'config_revision', v_revision)
    );
    v_log_intent := jsonb_build_object(
      'action', v_action,
      'book_id', v_book,
      'auto_production', (p_request->>'auto_production')::boolean,
      'auto_audit', (p_request->>'auto_audit')::boolean,
      'auto_iteration', (p_request->>'auto_iteration')::boolean,
      'presentation_intensity', (p_request->>'presentation_intensity')::numeric
    );
  END IF;

  v_log_intent := v_log_intent || jsonb_build_object('request_sha256', v_request_hash);
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_workbench', v_key, v_operator, CASE WHEN v_action = 'save_book_config' THEN v_book ELSE NULL END, v_log_intent, v_result);
  RETURN v_result;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN public.v7_error('INVALID_REQUEST', 'One or more workbench values have an invalid type or range.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_save_prompt_candidate(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_fp text := btrim(COALESCE(p_request->>'fp_target', ''));
  v_prompt text := p_request->>'prompt_text';
  v_key text := p_request->>'idempotency_key';
  v_version integer;
  v_id uuid;
  v_result jsonb;
  v_audit_intent jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'local_operator_id must be a UUID.');
  END;
  IF NOT public.v7_assert_operator(v_operator)
     OR p_request ? 'book_id'
     OR v_fp = ''
     OR COALESCE(v_prompt, '') = ''
     OR NOT public.v7_valid_idempotency_key(v_key) THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A global fp_target, prompt_text, and idempotency_key are required; prompt configuration is not book-scoped.');
  END IF;
  v_audit_intent := jsonb_build_object(
    'fp_target', v_fp,
    'prompt_sha256', encode(digest(convert_to(v_prompt, 'UTF8'), 'sha256'), 'hex'),
    'prompt_length', length(v_prompt)
  );
  v_result := public.v7_replay_product_request(
    'rpc_save_prompt_candidate', v_key, v_operator, NULL, v_audit_intent
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_save_prompt_candidate', v_key, v_operator, NULL, v_audit_intent
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  PERFORM public.v7_enable_internal_write();
  SELECT COALESCE(max(version), 0) + 1 INTO v_version
  FROM public.prompt_config
  WHERE local_operator_id = v_operator
    AND fp_target = v_fp;
  INSERT INTO public.prompt_config(
    local_operator_id, fp_target, version, prompt_text, status, is_active
  ) VALUES (
    v_operator, v_fp, v_version, v_prompt, 'candidate', false
  ) RETURNING id INTO v_id;
  INSERT INTO public.prompt_iteration_log(
    prompt_config_id, change_type, old_prompt_text, new_prompt_text, changed_by
  ) VALUES (
    v_id, 'candidate_created', NULL, v_prompt, v_operator
  );
  v_result := jsonb_build_object(
    'ok', true,
    'ids', jsonb_build_object('prompt_config_id', v_id),
    'state', jsonb_build_object('status', 'candidate', 'version', v_version)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_save_prompt_candidate', v_key, v_operator, NULL, v_audit_intent, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_promote_prompt_config(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_candidate_id uuid;
  v_key text := p_request->>'idempotency_key';
  v_creator_confirmed boolean;
  v_candidate public.prompt_config%ROWTYPE;
  v_result jsonb;
  v_outcome jsonb;
  v_sample_id uuid;
  v_sample_ids uuid[] := ARRAY[]::uuid[];
  v_sample public.iteration_log%ROWTYPE;
  v_previous_prompt text;
  v_audit_intent jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_candidate_id := NULLIF(p_request->>'prompt_config_id', '')::uuid;
    v_creator_confirmed := COALESCE(NULLIF(p_request->>'creator_confirmed', '')::boolean, false);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The prompt promotion identifiers or confirmation value are invalid.');
  END;
  IF NOT public.v7_assert_operator(v_operator)
     OR p_request ? 'book_id'
     OR NOT public.v7_valid_idempotency_key(v_key)
     OR NOT v_creator_confirmed THEN
    RETURN public.v7_error('PROMPT_CONFIRMATION_REQUIRED', 'Promoting a global prompt candidate requires creator confirmation and a valid idempotency_key; prompt configuration is not book-scoped.');
  END IF;
  v_audit_intent := public.v7_request_intent(p_request);
  v_result := public.v7_replay_product_request(
    'rpc_promote_prompt_config', v_key, v_operator, NULL, v_audit_intent
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_promote_prompt_config', v_key, v_operator, NULL, v_audit_intent
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT * INTO v_candidate
  FROM public.prompt_config
  WHERE id = v_candidate_id
    AND local_operator_id = v_operator
    AND status = 'candidate'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('PROMPT_CANDIDATE_REJECTED', 'The prompt candidate is unavailable.');
  END IF;
  IF jsonb_typeof(p_request->'sample_outcomes') <> 'array' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'sample_outcomes must be an array.');
  END IF;
  IF jsonb_array_length(p_request->'sample_outcomes') = 0 THEN
    RETURN public.v7_error('PROMPT_EXPERIMENT_INCOMPLETE', 'At least one persisted experiment sample is required before prompt promotion.');
  END IF;
  SELECT prompt_text INTO v_previous_prompt
  FROM public.prompt_config
  WHERE local_operator_id = v_operator
    AND fp_target = v_candidate.fp_target
    AND is_active
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_previous_prompt, '') = '' THEN
    RETURN public.v7_error('PROMPT_EXPERIMENT_INCOMPLETE', 'A current active prompt is required as the experiment baseline.');
  END IF;
  FOR v_outcome IN SELECT value FROM jsonb_array_elements(p_request->'sample_outcomes')
  LOOP
    IF jsonb_typeof(v_outcome) <> 'object'
       OR COALESCE(v_outcome->>'review_status', '') NOT IN ('confirmed', 'discarded') THEN
      RETURN public.v7_error('INVALID_REQUEST', 'Every sample outcome needs a confirmed or discarded review_status.');
    END IF;
    BEGIN
      v_sample_id := NULLIF(btrim(v_outcome->>'iteration_id'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.v7_error('INVALID_REQUEST', 'Every sample outcome needs a valid iteration_id UUID.');
    END;
    IF v_sample_id IS NULL THEN
      RETURN public.v7_error('INVALID_REQUEST', 'Every sample outcome needs a valid iteration_id UUID.');
    END IF;
    IF v_sample_id = ANY(v_sample_ids) THEN
      RETURN public.v7_error('INVALID_REQUEST', 'sample_outcomes must not contain the same iteration_id more than once.');
    END IF;
    SELECT * INTO v_sample
    FROM public.iteration_log
    WHERE id = v_sample_id
      AND local_operator_id = v_operator
      AND source_fp = v_candidate.fp_target
      AND review_status = 'pending_review'
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public.v7_error('SAMPLE_OUTCOME_REJECTED', 'Every sample outcome must reference a current pending-review sample for the promoted prompt target.');
    END IF;
    IF jsonb_typeof(v_sample.before_metric_json) IS DISTINCT FROM 'object'
       OR v_sample.before_metric_json = '{}'::jsonb
       OR jsonb_typeof(v_sample.after_metric_json) IS DISTINCT FROM 'object'
       OR v_sample.after_metric_json = '{}'::jsonb
       OR COALESCE(v_sample.before_prompt, '') = ''
       OR COALESCE(v_sample.after_prompt, '') = ''
       OR v_sample.before_prompt IS DISTINCT FROM v_previous_prompt
       OR v_sample.after_prompt IS DISTINCT FROM v_candidate.prompt_text THEN
      RETURN public.v7_error('PROMPT_EXPERIMENT_INCOMPLETE', 'Every promoted sample must persist non-empty before/after metrics and the exact active/candidate prompt snapshots.');
    END IF;
    v_sample_ids := array_append(v_sample_ids, v_sample_id);
  END LOOP;
  PERFORM 1
  FROM public.model_runtime_binding
  WHERE local_operator_id = v_operator
    AND node_code = v_candidate.fp_target
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error(
      'PROMPT_RUNTIME_BINDING_UNAVAILABLE',
      'The target node has no matching runtime binding for this local operator.'
    );
  END IF;
  PERFORM public.v7_enable_internal_write();
  UPDATE public.prompt_config
  SET status = 'archived', is_active = false
  WHERE local_operator_id = v_operator
    AND fp_target = v_candidate.fp_target
    AND is_active;
  UPDATE public.prompt_config
  SET status = 'active', is_active = true
  WHERE id = v_candidate_id;
  UPDATE public.model_runtime_binding
  SET prompt_config_id = v_candidate_id,
      prompt_version = v_candidate.version
  WHERE local_operator_id = v_operator
    AND node_code = v_candidate.fp_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V7_PROMPT_RUNTIME_BINDING_LOST';
  END IF;
  INSERT INTO public.prompt_iteration_log(
    prompt_config_id, change_type, old_prompt_text, new_prompt_text, changed_by
  ) VALUES (
    v_candidate_id, 'promotion',
    v_previous_prompt,
    v_candidate.prompt_text, v_operator
  );
  FOR v_outcome IN SELECT value FROM jsonb_array_elements(p_request->'sample_outcomes')
  LOOP
    UPDATE public.iteration_log
    SET review_status = v_outcome->>'review_status',
        confirmed_by = CASE WHEN v_outcome->>'review_status' = 'confirmed' THEN v_operator ELSE confirmed_by END,
        confirmed_at = CASE WHEN v_outcome->>'review_status' = 'confirmed' THEN clock_timestamp() ELSE confirmed_at END
    WHERE id = (v_outcome->>'iteration_id')::uuid
      AND local_operator_id = v_operator
      AND review_status = 'pending_review'
      AND v_outcome->>'review_status' IN ('confirmed', 'discarded');
  END LOOP;
  v_result := jsonb_build_object(
    'ok', true,
    'ids', jsonb_build_object('prompt_config_id', v_candidate_id),
    'state', jsonb_build_object('status', 'active', 'version', v_candidate.version)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_promote_prompt_config', v_key, v_operator, NULL, v_audit_intent, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_record_iteration_sample(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_book uuid;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_book := NULLIF(p_request->>'book_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The iteration sample scope is invalid.');
  END;
  IF NOT public.v7_assert_operator(v_operator)
     OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator, v_book)) THEN
    RETURN public.v7_error('SCOPE_REJECTED', 'The iteration sample scope is unavailable.');
  END IF;
  RETURN public.v7_error('ITERATION_RETRY_CONTRACT_UNRESOLVED', 'V7 allows a pool sample only after the third failed retry, but does not define the server-verifiable retry evidence contract.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_classify_iteration_sample(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid;
  v_id uuid;
  v_book uuid;
  v_key text := p_request->>'idempotency_key';
  v_status text := p_request->>'review_status';
  v_result jsonb;
BEGIN
  BEGIN
    v_operator := NULLIF(p_request->>'local_operator_id', '')::uuid;
    v_id := NULLIF(p_request->>'iteration_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.v7_error('INVALID_REQUEST', 'The iteration identifiers are invalid.');
  END;
  IF NOT public.v7_assert_operator(v_operator)
     OR NOT public.v7_valid_idempotency_key(v_key)
     OR COALESCE(v_status, '') NOT IN ('pending_review', 'discarded')
     OR COALESCE(p_request->>'root_debt_type', '') NOT IN ('data', 'prompt', 'skill')
     OR jsonb_typeof(p_request->'attribution_evidence_json') <> 'object' THEN
    RETURN public.v7_error('INVALID_REQUEST', 'A pool sample requires a valid idempotency_key, one root debt type, evidence, and a valid next status.');
  END IF;
  v_result := public.v7_replay_product_request(
    'rpc_classify_iteration_sample', v_key, v_operator, NULL, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  PERFORM 1 FROM public.local_operator
  WHERE local_operator_id = v_operator
  FOR UPDATE;
  v_result := public.v7_replay_product_request(
    'rpc_classify_iteration_sample', v_key, v_operator, NULL, public.v7_request_intent(p_request)
  );
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT book_id INTO v_book
  FROM public.iteration_log
  WHERE id = v_id
    AND local_operator_id = v_operator
    AND review_status = 'pool'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.v7_error('ITERATION_STATE_REJECTED', 'Only a current pool sample can be classified.');
  END IF;
  PERFORM public.v7_enable_internal_write();
  UPDATE public.iteration_log
  SET root_debt_type = p_request->>'root_debt_type',
      attribution_evidence_json = p_request->'attribution_evidence_json',
      review_status = v_status
  WHERE id = v_id;
  v_result := jsonb_build_object(
    'ok', true,
    'ids', jsonb_build_object('iteration_id', v_id),
    'state', jsonb_build_object('review_status', v_status)
  );
  INSERT INTO public.product_request_log(operation, idempotency_key, local_operator_id, book_id, intent, result)
  VALUES ('rpc_classify_iteration_sample', v_key, v_operator, v_book, public.v7_request_intent(p_request), v_result);
  RETURN v_result;
END;
$$;

COMMIT;
