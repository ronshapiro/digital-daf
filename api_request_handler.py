#!/usr/bin/python
# -*- coding: utf-8 -*-

from jastrow_reformat import reformat_jastrow
from link_sanitizer import sanitize_sefaria_links
from source_formatting.hebrew_small_to_emphasis import reformat_hebrew_small_text
from source_formatting.dibur_hamatchil import bold_diburei_hamatchil
import re
import requests

HADRAN_PATTERN = re.compile("^(<br>)+<big><strong>הדרן עלך .*")
BR_PREFIX = re.compile("^(<br>)+")

class RealRequestMaker(object):
    def request_amud(self, masechet, amud):
        return requests.get(
            # https://github.com/Sefaria/Sefaria-Project/wiki/API-Documentation
            "https://sefaria.org/api/texts/{masechet}.{amud}".format(masechet=masechet, amud=amud),
            # "context", "pad", and "multiple" are specified by Sefaria, but it's unclear what they do
            params = {
                "commentary": "1",
                # Even with wrapLinks=1, Jastrow (and perhaps more) is still wrapped. Instead, an active
                # filtering is performed just in case.
                "wrapLinks": "0",
            })

class ApiRequestHandler(object):
    def __init__(self, request_maker):
        self._request_maker = request_maker

    def amud_api_request(self, masechet, amud):
        sefaria_result = self._request_maker.request_amud(masechet, amud)
        if sefaria_result.status_code is not 200:
            return sefaria_result.text, 500
        try:
            sefaria_json = sefaria_result.json()
        except:
            return sefaria_result.text, 500

        result = {"id": amud}

        for i in ["title"]:
            result[i] = sefaria_json[i]

        hebrew = sefaria_json["he"]
        english = sefaria_json["text"]

        if len(hebrew) != len(english):
            return "Hebrew length != English length: %s" %(sefaria_result.text), 500

        result["sections"] = []
        for i in range(len(hebrew)):
            result["sections"].append({
                "he": hebrew[i],
                "en": sanitize_sefaria_links(english[i]),
                "ref": "%s.%s" %(sefaria_json["ref"], i + 1),
                "commentary": {},
                })

        section_prefix = "%s %s:" %(sefaria_json["book"], amud)
        for comment in sefaria_json["commentary"]:
            self._add_comment_to_result(comment, result["sections"], section_prefix)

        last_section = result["sections"][len(result["sections"]) - 1]
        if HADRAN_PATTERN.findall(last_section["he"]):
            last_section["he"] = BR_PREFIX.sub("<br>", last_section["he"])
            last_section["en"] = ""
            last_section["commentary"] = {}
            last_section["hadran"] = True

        return result

    def _add_comment_to_result(self, comment, sections, section_prefix):
        if len(comment["he"]) is 0 and \
           len(comment["text"]) is 0:
            return

        # TODO: question: if this spans multiple sections, is placing it in the first always correct?
        section = int(comment["anchorRefExpanded"][0][len(section_prefix):]) - 1

        if section >= len(sections):
            print("Unplaceable comment:", comment["sourceRef"], comment["anchorRefExpanded"])
            return

        commentary_dict = sections[section]["commentary"]
        matching_commentary_kind = _matching_commentary_kind(comment)
        if not matching_commentary_kind:
            return

        english_name = matching_commentary_kind["englishName"]
        if english_name not in commentary_dict:
            commentary_dict[english_name] = []

        hebrew = comment["he"]
        english = comment["text"]
        if hebrew == english:
            # Fix an issue where sometimes Sefaria returns the exact same text. For now, safe to
            # assume that the equivalent text is Hebrew.
            # TODO: this may no longer happen anymore
            english = ""

        hebrew = reformat_hebrew_small_text(hebrew)
        hebrew = bold_diburei_hamatchil(hebrew, english_name)
        english = sanitize_sefaria_links(english)
        if english_name == "Jastrow":
            english = reformat_jastrow(english)

        commentary_dict[english_name].append({
            "he": hebrew,
            "en": english,
            "ref": comment["ref"],
            "sourceRef": comment["sourceRef"],
            "sourceHeRef": comment["sourceHeRef"],
            })

_COMMENTARIES = [
    {
        "englishName": "Translation",
    },
    {
        "englishName": "Verses",
        "category": "Tanakh",
    },
    {
        "englishName": "Mishnah",
        "category": "Mishnah",
    },
    {
        "englishName": "Tosefta",
        "englishNamePattern": re.compile("^Tosefta "),
    },
    {
        "englishName": "Rashi",
    },
    {
        "englishName": "Tosafot",
    },
    {
        "englishName": "Ramban",
    },
    {
        "englishName": "Rashba",
    },
    {
        "englishName": "Maharsha",
        "englishNamePattern": re.compile("(Chidushei Halachot|Chidushei Agadot)"),
    },
    {
        "englishName": "Maharshal",
        "englishNamePattern": re.compile("(Chokhmat Shlomo on .*|Chokhmat Shlomo)"),
    },
    {
        "englishName": "Rosh",
        "englishNamePattern": re.compile("^Rosh on "),
    },
    {
        "englishName": "Ritva",
    },
    {
        "englishName": "Rav Nissim Gaon",
        "englishNamePattern": re.compile("^Rav Nissim Gaon on "),
    },
    {
        "englishName": "Shulchan Arukh",
        "englishNamePattern": re.compile("^Shulchan Arukh, "),
    },
    {
        "englishName": "Mishneh Torah",
        "englishNamePattern": re.compile("^Mishneh Torah, "),
    },
    #  {
    #    "englishName": "Sefer Mitzvot Gadol",
    #  },
    {
        "englishName": "Mesorat Hashas",
        "type": "mesorat hashas",
    },
    {
        "englishName": "Jastrow",
    },
    {
        "englishName": "Steinsaltz",
    }
];

def _has_matching_property(first, second, property_name):
    return property_name in first and \
        property_name in second and \
        first[property_name] == second[property_name]

def _matching_commentary_kind(comment):
    name = comment["collectiveTitle"]["en"]
    for kind in _COMMENTARIES:
        if name == kind["englishName"] or \
           _has_matching_property(comment, kind, "category") or \
           _has_matching_property(comment, kind, "type") or \
           "englishNamePattern" in kind and kind["englishNamePattern"].findall(name):
            return kind
